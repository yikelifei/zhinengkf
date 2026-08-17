using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Microsoft.Win32;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Input;
using FlaUI.UIA3;
using WeAutoCommon.Models;
using WeChatAuto.Components;
using WeChatAuto.Extentions;
using WeChatAuto.Models;
using WeChatAuto.Options;
using WeChatAuto.Services;
using WeChatAuto.Utils;

var options = HostArguments.Parse(args);
if (options.Help || (!options.Probe && !options.OcrProbe && !options.OcrWatch && !options.Watch && !options.Inspect && !options.Profiles))
{
    Console.WriteLine("Usage: PersonalWechatRpaHost --inspect|--profiles|--probe|--ocr-probe|--ocr-watch|--watch [--config <path>]");
    return;
}

var config = HostConfig.Load(options.ConfigPath);
config.Validate(options.Watch || options.OcrWatch);
ConfigureSdkWithoutGlobalSideEffects(config);
// OCR operation does not need Narrator or the accessibility compatibility flag.
// Keep that state untouched for the OCR fallback so the user's system remains unchanged.
using var accessibility = options.OcrProbe || options.OcrWatch
    ? null
    : NarratorAccessibilityScope.Enable(config.AccessibilityStatePath);
if (accessibility is not null) Thread.Sleep(500);

if (options.Inspect)
{
    WriteJson(WindowInspector.Inspect(config.CapturePath));
    return;
}
if (options.Profiles)
{
    WriteJson(ProfileInspector.Capture(config.CapturePath));
    return;
}

var services = new ServiceCollection();
services.AddLogging(builder => builder.AddConsole().SetMinimumLevel(LogLevel.Warning));
services.AddAutoLogger();
services.AddSingleton<WeChatClientFactory>();
services.AddSingleton(new WeChatCaptureImage(config.CapturePath));
services.AddSingleton(new WeChatRecordVideo(config.VideoPath));
services.AddSingleton<OCRService>();
using var provider = services.BuildServiceProvider();
if (options.OcrProbe || options.OcrWatch)
{
    var ocr = provider.GetRequiredService<OCRService>();
    ocr.InitOCREngin(WeAutomation.Config);
    await Task.Delay(TimeSpan.FromSeconds(2));
    var pinnedIdentity = AccountsConfigWriter.TryReadLiveIdentity(
        config.AccountsConfigPath,
        config.AccountNickname,
        config.OwnerWxId);
    var result = pinnedIdentity is null
        ? OcrAccountProbe.Find(config, ocr)
        : new OcrProbeResult(
            true,
            "pinned_runtime_identity",
            true,
            true,
            pinnedIdentity,
            Process.GetProcessesByName("Weixin").Length,
            [new
            {
                processId = pinnedIdentity.ProcessId,
                windowHandle = pinnedIdentity.WindowHandle,
                windowsSessionId = pinnedIdentity.WindowsSessionId,
                code = "verified_pinned_runtime_identity",
            }]);
    if (!result.Ok || result.Target is null)
    {
        WriteJson(result);
        Environment.ExitCode = 4;
        return;
    }
    if (options.OcrProbe)
    {
        WriteJson(result);
        return;
    }

    using var ocrCancellation = new CancellationTokenSource();
    Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; ocrCancellation.Cancel(); };
    var ocrHost = new OcrRpaHost(config, ocr, result.Target, ocrCancellation.Token);
    AccountsConfigWriter.RefreshIdentity(config.AccountsConfigPath, result.Target);
    await ocrHost.RunAsync();
    return;
}
using var factory = provider.GetRequiredService<WeChatClientFactory>();

var discovery = TargetClientDiscovery.Find(provider, factory, config.AccountNickname);
if (discovery.Client is null)
{
    WriteJson(new { ok = false, code = "target_account_not_found", targetAccountNickname = config.AccountNickname, discoveredAccountCount = discovery.DiscoveredWindowCount });
    Environment.ExitCode = 2;
    return;
}
using var client = discovery.Client;

var identity = RuntimeIdentity.From(client);
if (!String.Equals(config.OwnerWxId, identity.OwnerWxId, StringComparison.Ordinal))
{
    WriteJson(new
    {
        ok = false,
        code = "target_owner_wxid_mismatch",
        targetAccountNickname = config.AccountNickname,
        expectedOwnerWxId = config.OwnerWxId,
        actualOwnerWxId = identity.OwnerWxId,
    });
    Environment.ExitCode = 3;
    return;
}
if (options.Probe)
{
    WriteJson(new { ok = true, accountVerified = true, target = identity, discoveredAccountCount = discovery.DiscoveredWindowCount });
    return;
}

using var cancellation = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
var host = new RpaHost(config, client, identity, cancellation.Token);
AccountsConfigWriter.RefreshIdentity(config.AccountsConfigPath, identity);
await host.RunAsync();

static void ConfigureSdkWithoutGlobalSideEffects(HostConfig config)
{
    // Deliberately do not call WeAutomation.Initialize(): upstream changes Narrator registry state
    // and display-sleep policy. Registering the required services manually avoids those mutations.
    var sdk = WeAutomation.Config;
    sdk.DebugMode = false;
    sdk.EnableOCR = config.EnableOcr;
    sdk.EnableRecordVideo = false;
    sdk.EnableMouseKeyboardSimulator = false;
    sdk.InitAdressBook = false;
    sdk.ListenInterval = config.ListenIntervalSeconds;
    sdk.MonitorMessageInterval = config.ListenIntervalSeconds;
    sdk.MaxHistoryMessageFetchNumber = 30;
    sdk.DefaultSavePath = config.DownloadPath;
    sdk.CaptureUIPath = config.CapturePath;
    sdk.TargetVideoPath = config.VideoPath;
    if (config.EnableOcr)
    {
        sdk.OCRDetModelFilePath = Path.Combine(config.ModelsPath, "ch_PP-OCRv5_mobile_det.onnx");
        sdk.OCRClsModelFilePath = Path.Combine(config.ModelsPath, "ch_ppocr_mobile_v2.0_cls_infer.onnx");
        sdk.OCRRecModelFilePath = Path.Combine(config.ModelsPath, "ch_PP-OCRv5_rec_mobile_infer.onnx");
        sdk.OCRDictModelFilePath = Path.Combine(config.ModelsPath, "ppocrv5_dict.txt");
    }
}

static void WriteJson(object value) => Console.WriteLine(JsonSerializer.Serialize(value, JsonDefaults.Options));

sealed class RpaHost
{
    private const string EventVersion = "personal_wechat_rpa_event_v1";
    private readonly HostConfig _config;
    private readonly WeChatClient _client;
    private readonly RuntimeIdentity _identity;
    private readonly CancellationToken _token;
    private readonly HttpClient _api;
    private readonly Channel<InboundEvent> _inbound = Channel.CreateBounded<InboundEvent>(new BoundedChannelOptions(200)
    {
        SingleReader = true,
        SingleWriter = false,
        FullMode = BoundedChannelFullMode.DropOldest,
    });
    private readonly ConcurrentDictionary<string, string> _lastInboundByChat = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    public RpaHost(HostConfig config, WeChatClient client, RuntimeIdentity identity, CancellationToken token)
    {
        _config = config;
        _client = client;
        _identity = identity;
        _token = token;
        _api = new HttpClient { BaseAddress = new Uri(config.ApiBase), Timeout = TimeSpan.FromSeconds(30) };
        _api.DefaultRequestHeaders.Add("x-personal-wechat-rpa-token", config.Token);
    }

    public async Task RunAsync()
    {
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{_config.Port}/");
        listener.Start();

        var postTask = PostInboundLoopAsync();
        var httpTask = HttpLoopAsync(listener);
        var monitorTask = _client.MessageMonitor.AddMessageListener(
            Array.Empty<string>(),
            OnMessages,
            IsOpenMonitor: true,
            userToken: _token,
            options: new MessageMonitorOptions
            {
                FetchFriendInfo = false,
                FetchImage = true,
                FetchVoiceChat = false,
                ClickRedEnvelope = false,
                IsRiskPrevention = true,
            });

        Console.WriteLine(JsonSerializer.Serialize(new { ok = true, status = "watching", endpoint = $"http://127.0.0.1:{_config.Port}", target = _identity }, JsonDefaults.Options));
        try
        {
            await Task.WhenAny(postTask, httpTask, monitorTask);
            _token.ThrowIfCancellationRequested();
            await Task.WhenAll(postTask, httpTask, monitorTask);
        }
        catch (OperationCanceledException) when (_token.IsCancellationRequested)
        {
            // Normal shutdown.
        }
        finally
        {
            listener.Stop();
            _api.Dispose();
        }
    }

    private void OnMessages(MessageContext context)
    {
        if (!StringComparer.Ordinal.Equals(context.OwnerNickName, _config.AccountNickname)) return;
        var chatTitle = (context.ConversationTitle ?? "").Trim();
        if (chatTitle.Length == 0) return;
        foreach (var message in context.NewMessages ?? [])
        {
            var sender = (message.Who ?? "").Trim();
            if (sender is "我" or "系统" || StringComparer.Ordinal.Equals(sender, _config.AccountNickname)) continue;
            var text = (message.Message ?? "").Trim();
            var attachments = new List<object>();
            if (!String.IsNullOrWhiteSpace(message.ImageFile))
            {
                attachments.Add(new { kind = "image", localPath = Path.GetFullPath(message.ImageFile) });
                if (text.Length == 0) text = "[图片]";
            }
            if (text.Length == 0 && attachments.Count == 0) continue;
            var createdAt = message.SendDate == default ? DateTimeOffset.Now : new DateTimeOffset(message.SendDate);
            var messageType = NormalizeMessageType(message.MessageType.ToString(), attachments.Count > 0);
            var externalId = Sha256(String.Join("\n", _identity.OwnerWxId, chatTitle, sender, text, createdAt.ToString("O"), messageType));
            _lastInboundByChat[chatTitle] = text;
            _inbound.Writer.TryWrite(new InboundEvent(
                EventVersion,
                _config.AccountNickname,
                _identity.OwnerWxId,
                chatTitle,
                NormalizeConversationType(context.ConversationType),
                sender,
                text,
                messageType,
                externalId,
                createdAt.ToString("O"),
                attachments,
                "uia_accessibility"));
        }
    }

    private async Task PostInboundLoopAsync()
    {
        await foreach (var item in _inbound.Reader.ReadAllAsync(_token))
        {
            try
            {
                using var response = await _api.PostAsJsonAsync("personal-wechat-rpa/inbound", item, JsonDefaults.Options, _token);
                var body = await response.Content.ReadAsStringAsync(_token);
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"API rejected inbound event: {(int)response.StatusCode} {body}");
                using var document = JsonDocument.Parse(body);
                if (document.RootElement.TryGetProperty("binding", out var binding))
                {
                    AccountsConfigWriter.Upsert(_config.AccountsConfigPath, _identity, binding, item.ChatTitle);
                }
            }
            catch (Exception error) when (!_token.IsCancellationRequested)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, code = "inbound_post_failed", errorMessage = error.Message, item.ExternalId }, JsonDefaults.Options));
            }
        }
    }

    private async Task HttpLoopAsync(HttpListener listener)
    {
        while (!_token.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync().WaitAsync(_token); }
            catch (OperationCanceledException) { break; }
            _ = Task.Run(() => HandleHttpAsync(context), _token);
        }
    }

    private async Task HandleHttpAsync(HttpListenerContext context)
    {
        try
        {
            if (!TokenMatches(context.Request.Headers["x-personal-wechat-rpa-token"], _config.Token))
            {
                await RespondAsync(context, 401, new { ok = false, code = "invalid_token" });
                return;
            }
            var route = context.Request.Url?.AbsolutePath.TrimEnd('/').ToLowerInvariant() ?? "";
            if (context.Request.HttpMethod == "GET" && route == "/health")
            {
                await RespondAsync(context, 200, new { ok = true, status = "watching", sendEnabled = _config.SendEnabled, target = _identity });
                return;
            }
            if (context.Request.HttpMethod == "POST" && route == "/probe")
            {
                await RespondAsync(context, 200, new { ok = true, accountVerified = true, target = _identity });
                return;
            }
            if (context.Request.HttpMethod == "POST" && route == "/send")
            {
                using var document = await JsonDocument.ParseAsync(context.Request.InputStream, cancellationToken: _token);
                var result = await SendAsync(document.RootElement);
                await RespondAsync(context, result.Ok ? 200 : 409, result);
                return;
            }
            await RespondAsync(context, 404, new { ok = false, code = "not_found" });
        }
        catch (Exception error)
        {
            await RespondAsync(context, 500, new { ok = false, code = "host_error", errorMessage = error.Message });
        }
    }

    private async Task<SendResult> SendAsync(JsonElement operation)
    {
        if (!_config.SendEnabled)
            return SendResult.Fail("real_send_disabled", "PERSONAL_WECHAT_SEND is not 1");
        await _sendLock.WaitAsync(_token);
        try
        {
            var binding = operation.GetProperty("binding");
            var expected = operation.GetProperty("expected");
            var actions = operation.GetProperty("actions");
            var chatTitle = expected.GetProperty("chatTitle").GetString()?.Trim() ?? "";
            var recentMessage = expected.GetProperty("recentMessageText").GetString()?.Trim() ?? "";
            var accountVerified =
                binding.GetProperty("accountNickname").GetString() == _identity.AccountNickname &&
                binding.GetProperty("ownerWxId").GetString() == _identity.OwnerWxId &&
                binding.GetProperty("processId").GetInt32() == _identity.ProcessId &&
                binding.GetProperty("windowHandle").GetString() == _identity.WindowHandle &&
                binding.GetProperty("windowsSessionId").GetInt32() == _identity.WindowsSessionId;
            if (!accountVerified) return SendResult.Fail("account_identity_mismatch", "runtime account/process/window/session does not match the bound dispatch", accountVerified: false);
            if (expected.GetProperty("accountText").GetString() != _identity.AccountNickname)
                return SendResult.Fail("account_text_mismatch", "expected account text does not match the dedicated account");
            if (chatTitle.Length == 0) return SendResult.Fail("chat_title_missing", "chat title is required");
            if (!_lastInboundByChat.TryGetValue(chatTitle, out var observedRecent) || !StringComparer.Ordinal.Equals(observedRecent, recentMessage))
                return SendResult.Fail("recent_message_mismatch", "the expected recent customer message was not observed by this RPA host");
            if (actions.GetArrayLength() == 0) return SendResult.Fail("actions_missing", "at least one action is required");

            var verified = 0;
            foreach (var action in actions.EnumerateArray())
            {
                var type = action.GetProperty("type").GetString();
                var before = await _client.GetChatHistory(chatTitle, DateTime.Today);
                var beforeKeys = before.Select(HistoryKey).ToHashSet(StringComparer.Ordinal);
                if (type == "text")
                {
                    var text = action.GetProperty("text").GetString()?.Trim() ?? "";
                    if (text.Length == 0) return SendResult.Fail("text_missing", "text action is empty", verified);
                    await _client.SendMessage(chatTitle, text);
                    if (!await ObserveNewOutgoingAsync(chatTitle, beforeKeys, text))
                        return SendResult.Fail("send_not_observed", "sent text was not observed in chat history", verified);
                }
                else if (type == "image")
                {
                    var filePath = Path.GetFullPath(action.GetProperty("filePath").GetString() ?? "");
                    if (!File.Exists(filePath)) return SendResult.Fail("image_missing", "image file does not exist", verified);
                    await _client.SendFile(chatTitle, [filePath]);
                    if (!await ObserveNewOutgoingAsync(chatTitle, beforeKeys, null))
                        return SendResult.Fail("send_not_observed", "sent image was not observed in chat history", verified);
                }
                else
                {
                    return SendResult.Fail("unsupported_action", $"unsupported action type: {type}", verified);
                }
                verified++;
            }
            return new SendResult(true, null, null, true, true, true, true, verified);
        }
        catch (Exception error)
        {
            return SendResult.Fail("send_failed", error.Message);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private async Task<bool> ObserveNewOutgoingAsync(string chatTitle, HashSet<string> beforeKeys, string? expectedText)
    {
        for (var index = 0; index < 8; index++)
        {
            await Task.Delay(750, _token);
            var after = await _client.GetChatHistory(chatTitle, DateTime.Today);
            var added = after.Where(item => !beforeKeys.Contains(HistoryKey(item))).ToList();
            if (added.Any(item => IsSelf(item.Who) && (expectedText is null || StringComparer.Ordinal.Equals(item.Message?.Trim(), expectedText)))) return true;
        }
        return false;
    }

    private static string HistoryKey(ChatSimpleMessage message) =>
        !String.IsNullOrWhiteSpace(message.UniqueString)
            ? message.UniqueString
            : Sha256(String.Join("\n", message.Who, message.Message, message.DateTime.ToString("O")));

    private static bool IsSelf(string? who) => (who ?? "").Trim() is "我" or "自己";

    private static async Task RespondAsync(HttpListenerContext context, int statusCode, object body)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(body, JsonDefaults.Options);
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes);
        context.Response.Close();
    }

    private static bool TokenMatches(string? actual, string expected)
    {
        var left = Encoding.UTF8.GetBytes(actual ?? "");
        var right = Encoding.UTF8.GetBytes(expected);
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }

    private static string NormalizeMessageType(string value, bool hasImage)
    {
        if (hasImage) return "image";
        var lower = value.ToLowerInvariant();
        if (lower.Contains("text") || value.Contains("文本")) return "text";
        if (lower.Contains("file") || value.Contains("文件")) return "file";
        if (lower.Contains("voice") || value.Contains("语音")) return "voice";
        if (lower.Contains("video") || value.Contains("视频")) return "video";
        if (lower.Contains("link") || value.Contains("链接")) return "link";
        return "unknown";
    }

    private static string NormalizeConversationType(string value)
    {
        if (value.Contains("群")) return "group";
        if (value.Contains("企业")) return "enterprise";
        if (value.Contains("好友")) return "direct";
        return "unknown";
    }

    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}

sealed record InboundEvent(
    string Version,
    string AccountNickname,
    string OwnerWxId,
    string ChatTitle,
    string ConversationType,
    string SenderName,
    string Message,
    string MessageType,
    string ExternalId,
    string CreatedAt,
    List<object> Attachments,
    string CaptureSource);

sealed record SendResult(
    bool Ok,
    string? Code,
    string? ErrorMessage,
    bool AccountVerified,
    bool ChatVerified,
    bool RecentMessageVerified,
    bool OperationVerified,
    int ActionCount)
{
    public static SendResult Fail(string code, string message, int actionCount = 0, bool accountVerified = true) =>
        new(false, code, message, accountVerified, false, false, false, actionCount);
}

sealed record RuntimeIdentity(
    string AccountNickname,
    string OwnerWxId,
    int ProcessId,
    string WindowHandle,
    int WindowsSessionId,
    string ProcessName,
    string ExecutablePath)
{
    public static RuntimeIdentity From(WeChatClient client)
    {
        using var process = Process.GetProcessById(client.ClientProcessId);
        return new RuntimeIdentity(
            client.NickName,
            client.WxId,
            client.ClientProcessId,
            client.MainWindow.Properties.NativeWindowHandle.Value.ToString(),
            process.SessionId,
            process.ProcessName,
            process.MainModule?.FileName ?? "");
    }
}

sealed record TargetClientDiscovery(WeChatClient? Client, int DiscoveredWindowCount)
{
    public static TargetClientDiscovery Find(IServiceProvider provider, WeChatClientFactory factory, string targetNickname)
    {
        var mainProcesses = Process.GetProcessesByName("Weixin")
            .Where(process => process.MainWindowHandle != IntPtr.Zero && process.MainWindowTitle.Trim() == "微信")
            .OrderBy(process => process.Id)
            .ToList();
        var method = typeof(WeChatClientFactory).GetMethod("__GetCurrentWxNickName", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingMethodException("WeChatClientFactory.__GetCurrentWxNickName");
        using var automation = new UIA3Automation();
        var monitorGate = new SemaphoreSlim(1, 1);
        var index = 0;
        foreach (var process in mainProcesses)
        {
            index++;
            try
            {
                var result = method.Invoke(factory, [process.Id, automation]);
                if (result is not ValueTuple<OwerInfo, Window> tuple) continue;
                var info = tuple.Item1;
                if (!StringComparer.Ordinal.Equals(info.NickName?.Trim(), targetNickname)) continue;
                var client = new WeChatClient(
                    process.Id,
                    provider,
                    factory,
                    tuple.Item2,
                    WeChatClientFactory.MainActionThreadInvoker,
                    info,
                    index,
                    monitorGate);
                foreach (var item in mainProcesses) item.Dispose();
                return new TargetClientDiscovery(client, mainProcesses.Count);
            }
            catch (TargetInvocationException error)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, code = "window_probe_failed", processId = process.Id, errorMessage = error.InnerException?.Message ?? error.Message }, JsonDefaults.Options));
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, code = "window_probe_failed", processId = process.Id, errorMessage = error.Message }, JsonDefaults.Options));
            }
        }
        monitorGate.Dispose();
        foreach (var process in mainProcesses) process.Dispose();
        return new TargetClientDiscovery(null, mainProcesses.Count);
    }
}

static class WindowInspector
{
    public static object Inspect(string capturePath)
    {
        using var automation = new UIA3Automation();
        var results = new List<object>();
        foreach (var process in Process.GetProcessesByName("Weixin").Where(item => item.MainWindowHandle != IntPtr.Zero).OrderBy(item => item.Id))
        {
            try
            {
                var window = automation.GetDesktop().FindFirstChild(cf => cf.ByProcessId(process.Id).And(cf.ByControlType(FlaUI.Core.Definitions.ControlType.Window)));
                if (window is null) continue;
                Directory.CreateDirectory(capturePath);
                var screenshotPath = Path.Combine(capturePath, $"inspect-{process.Id}.png");
                window.CaptureToFile(screenshotPath);
                var elements = window.FindAllDescendants()
                    .Select(element => new
                    {
                        name = Safe(() => element.Name),
                        automationId = Safe(() => element.AutomationId),
                        className = Safe(() => element.ClassName),
                        controlType = Safe(() => element.ControlType.ToString()),
                    })
                    .Where(element =>
                        ContainsProbeTerm(element.name) ||
                        ContainsProbeTerm(element.automationId) ||
                        ContainsProbeTerm(element.className))
                    .Take(200)
                    .ToList();
                results.Add(new { processId = process.Id, windowHandle = process.MainWindowHandle.ToInt64().ToString(), title = process.MainWindowTitle, screenshotPath, elements });
            }
            catch (Exception error)
            {
                results.Add(new { processId = process.Id, errorMessage = error.Message });
            }
            finally
            {
                process.Dispose();
            }
        }
        return new { ok = true, windows = results };
    }

    private static bool ContainsProbeTerm(string value)
    {
        var text = value.ToLowerInvariant();
        return text.Contains("tab") || text.Contains("nav") || text.Contains("head") || text.Contains("avatar") || text.Contains("weixin") || text.Contains("微信") || text.Contains("导航");
    }

    private static string Safe(Func<string> read)
    {
        try { return read() ?? ""; } catch { return ""; }
    }
}

static class ProfileInspector
{
    public static object Capture(string capturePath)
    {
        using var automation = new UIA3Automation();
        Directory.CreateDirectory(capturePath);
        var captures = new List<object>();
        foreach (var process in Process.GetProcessesByName("Weixin").Where(item => item.MainWindowHandle != IntPtr.Zero).OrderBy(item => item.Id))
        {
            try
            {
                var window = automation.GetDesktop().FindFirstChild(cf => cf.ByProcessId(process.Id).And(cf.ByControlType(FlaUI.Core.Definitions.ControlType.Window)))?.AsWindow();
                if (window is null) continue;
                window.Focus();
                Thread.Sleep(400);
                var bounds = window.BoundingRectangle;
                Mouse.Position = new System.Drawing.Point(bounds.Left + 32, bounds.Top + 60);
                Mouse.LeftClick();
                Thread.Sleep(1000);
                var screenshotPath = Path.Combine(capturePath, $"profile-{process.Id}.png");
                automation.GetDesktop().CaptureToFile(screenshotPath);
                captures.Add(new { processId = process.Id, screenshotPath });
                Mouse.Position = new System.Drawing.Point(bounds.Left + Math.Min(500, bounds.Width - 20), bounds.Top + 90);
                Mouse.LeftClick();
                Thread.Sleep(400);
            }
            catch (Exception error)
            {
                captures.Add(new { processId = process.Id, errorMessage = error.Message });
            }
            finally
            {
                process.Dispose();
            }
        }
        return new { ok = true, captures };
    }
}

sealed record OcrProbeResult(
    bool Ok,
    string Code,
    bool AccountNicknameVerified,
    bool OwnerWxIdVerified,
    RuntimeIdentity? Target,
    int DiscoveredAccountCount,
    List<object> Windows);

static class OcrAccountProbe
{
    public static OcrProbeResult Find(HostConfig config, OCRService ocr)
    {
        using var automation = new UIA3Automation();
        var windows = new List<object>();
        RuntimeIdentity? target = null;
        var accountNicknameVerified = false;
        var ownerWxIdVerified = false;
        var allProcesses = Process.GetProcessesByName("Weixin").OrderBy(item => item.Id).ToList();
        foreach (var item in allProcesses) item.Refresh();
        var nativeHandles = allProcesses.ToDictionary(item => item.Id, item => NativeWindowActions.FindWeChatWindow(item.Id));
        var processes = allProcesses
            .Where(item => nativeHandles[item.Id] != IntPtr.Zero)
            .OrderBy(item => item.Id)
            .ToList();
        if (processes.Count == 0)
        {
            windows.AddRange(allProcesses.Select(item => (object)new
            {
                processId = item.Id,
                windowsSessionId = item.SessionId,
                mainWindowHandle = nativeHandles[item.Id].ToInt64().ToString(),
                mainWindowTitle = NativeWindowActions.GetWindowTitle(nativeHandles[item.Id]),
                code = "not_a_visible_wechat_main_window",
            }));
        }

        foreach (var process in processes)
        {
            try
            {
                var windowHandle = nativeHandles[process.Id];
                var window = automation.GetDesktop().FindFirstChild(cf => cf.ByProcessId(process.Id).And(cf.ByControlType(FlaUI.Core.Definitions.ControlType.Window)))?.AsWindow();
                if (window is null)
                {
                    windows.Add(new { processId = process.Id, code = "window_not_found" });
                    continue;
                }

                NativeWindowActions.RestoreAndFocus(windowHandle);
                Thread.Sleep(800);
                var bounds = window.BoundingRectangle;
                Mouse.Position = new Point(bounds.Left + 32, bounds.Top + 60);
                Mouse.LeftClick();
                Thread.Sleep(1200);

                var captureBounds = Rectangle.Intersect(
                    new Rectangle(bounds.Left, bounds.Top, bounds.Width, bounds.Height),
                    NativeWindowActions.PrimaryScreenBounds());
                using var bitmap = OCRService.CaptureRect(captureBounds);
                Directory.CreateDirectory(config.CapturePath);
                var screenshotPath = Path.Combine(config.CapturePath, $"ocr-profile-{process.Id}.png");
                bitmap.Save(screenshotPath, ImageFormat.Png);
                var profileBounds = new Rectangle(0, 0, Math.Min(380, bitmap.Width), Math.Min(190, bitmap.Height));
                using var profileBitmap = bitmap.Clone(profileBounds, PixelFormat.Format24bppRgb);
                var detected = ocr.Detect(
                    profileBitmap,
                    padding: 0,
                    maxSideLen: Math.Max(profileBitmap.Width, profileBitmap.Height),
                    boxScoreThresh: 0.3f,
                    boxThresh: 0.3f,
                    unClipRatio: 1.6f,
                    doAngle: false,
                    mostAngle: false,
                    isTest: false);
                var textBlocks = detected.TextBlocks
                    .Where(block => !String.IsNullOrWhiteSpace(block.Text))
                    .Select(block => block.Text.Trim())
                    .ToList();
                var profileTextBlocks = detected.TextBlocks
                    .Where(block => !String.IsNullOrWhiteSpace(block.Text))
                    .Select(block => block.Text.Trim())
                    .ToList();
                var normalizedProfileText = Normalize(String.Join("\n", profileTextBlocks));
                var nicknameMatch = normalizedProfileText.Contains(Normalize(config.AccountNickname), StringComparison.Ordinal);
                var exactWxIdMatch = normalizedProfileText.Contains(Normalize(config.OwnerWxId), StringComparison.OrdinalIgnoreCase);
                var ocrEquivalentWxIdMatch = NormalizeOcrIdentity(normalizedProfileText)
                    .Contains(NormalizeOcrIdentity(config.OwnerWxId), StringComparison.OrdinalIgnoreCase);
                var ocrEquivalentWxIdSuffixMatch = HasOcrIdentitySuffix(normalizedProfileText, config.OwnerWxId);
                var ocrSplitOwnerWxIdMatch = HasOcrIdentityFragments(profileTextBlocks, config.OwnerWxId);
                var wxidMatch = exactWxIdMatch || ocrEquivalentWxIdMatch || ocrEquivalentWxIdSuffixMatch || ocrSplitOwnerWxIdMatch;

                windows.Add(new
                {
                    processId = process.Id,
                    windowHandle = windowHandle.ToInt64().ToString(),
                    windowsSessionId = process.SessionId,
                    screenshotPath,
                    textBlockCount = textBlocks.Count,
                    profileTextBlocks,
                    nicknameMatch,
                    exactOwnerWxIdMatch = exactWxIdMatch,
                    ocrEquivalentOwnerWxIdMatch = ocrEquivalentWxIdMatch,
                    ocrEquivalentOwnerWxIdSuffixMatch = ocrEquivalentWxIdSuffixMatch,
                    ocrSplitOwnerWxIdMatch,
                    ownerWxIdMatch = wxidMatch,
                });
                if (nicknameMatch && wxidMatch)
                {
                    target = new RuntimeIdentity(
                        config.AccountNickname,
                        config.OwnerWxId,
                        process.Id,
                        windowHandle.ToInt64().ToString(),
                        process.SessionId,
                        process.ProcessName,
                        process.MainModule?.FileName ?? "");
                    accountNicknameVerified = true;
                    ownerWxIdVerified = true;
                }

                Mouse.Position = new Point(bounds.Left + Math.Min(500, bounds.Width - 20), bounds.Top + 90);
                Mouse.LeftClick();
                Thread.Sleep(400);
            }
            catch (Exception error)
            {
                windows.Add(new { processId = process.Id, code = "ocr_probe_failed", errorMessage = error.Message });
            }
            finally
            {
                process.Dispose();
            }
        }

        foreach (var process in allProcesses.Where(item => !processes.Contains(item))) process.Dispose();
        return target is null
            ? new OcrProbeResult(false, "target_account_not_found_by_ocr", accountNicknameVerified, ownerWxIdVerified, null, processes.Count, windows)
            : new OcrProbeResult(true, "ok", true, true, target, processes.Count, windows);
    }

    private static string Normalize(string value) => String.Concat(value.Where(character => !Char.IsWhiteSpace(character)))
        .Replace("：", ":", StringComparison.Ordinal)
        .ToLowerInvariant();

    private static string NormalizeOcrIdentity(string value) => Normalize(value)
        .Replace('i', '1')
        .Replace('l', '1');

    private static bool HasOcrIdentitySuffix(string normalizedProfileText, string ownerWxId)
    {
        var profile = NormalizeOcrIdentity(normalizedProfileText);
        var expected = NormalizeOcrIdentity(ownerWxId);
        var suffix = expected.StartsWith("wxid_", StringComparison.Ordinal)
            ? expected["wxid_".Length..]
            : expected;
        suffix = suffix.Trim('_');
        if (suffix.Length < 12) return false;
        if (profile.Contains(suffix, StringComparison.OrdinalIgnoreCase)) return true;

        var tail = suffix[^Math.Min(12, suffix.Length)..];
        return tail.Length >= 12 && profile.Contains(tail, StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasOcrIdentityFragments(IEnumerable<string> profileTextBlocks, string ownerWxId)
    {
        var expected = NormalizeOcrIdentity(ownerWxId).Replace("_", "", StringComparison.Ordinal);
        if (expected.StartsWith("wxid", StringComparison.Ordinal)) expected = expected["wxid".Length..];
        if (expected.Length < 12) return false;

        var blocks = profileTextBlocks
            .Select(block => NormalizeOcrIdentity(block).Replace("_", "", StringComparison.Ordinal))
            .Where(block => block.Length > 0)
            .ToList();
        for (var prefixLength = expected.Length - 3; prefixLength >= 9; prefixLength--)
        {
            var prefix = expected[..prefixLength];
            var tail = expected[prefixLength..];
            var hasIdentityPrefix = blocks.Any(block =>
                block.Contains($"wxid{prefix}", StringComparison.OrdinalIgnoreCase) ||
                block.Contains(prefix, StringComparison.OrdinalIgnoreCase));
            if (!hasIdentityPrefix) continue;
            if (blocks.Any(block => block.Contains(tail, StringComparison.OrdinalIgnoreCase))) return true;
        }
        return false;
    }
}

static class NativeWindowActions
{
    private const int SwRestore = 9;
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;

    public static void RestoreAndFocus(IntPtr handle)
    {
        ShowWindow(handle, SwRestore);
        SetForegroundWindow(handle);
    }

    public static Rectangle PrimaryScreenBounds() => new(0, 0, GetSystemMetrics(SmCxScreen), GetSystemMetrics(SmCyScreen));

    public static IntPtr FindWeChatWindow(int processId)
    {
        var found = IntPtr.Zero;
        EnumWindows((handle, _) =>
        {
            GetWindowThreadProcessId(handle, out var ownerProcessId);
            if (ownerProcessId != (uint)processId || !IsWindowVisible(handle)) return true;
            if (!StringComparer.Ordinal.Equals(GetWindowTitle(handle).Trim(), "微信")) return true;
            found = handle;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    public static string GetWindowTitle(IntPtr handle)
    {
        if (handle == IntPtr.Zero) return "";
        var length = GetWindowTextLength(handle);
        if (length <= 0) return "";
        var buffer = new StringBuilder(length + 1);
        GetWindowText(handle, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr handle, int command);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr handle);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    private delegate bool EnumWindowsCallback(IntPtr handle, IntPtr parameter);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr handle);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr handle, StringBuilder buffer, int maximumCount);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr handle);
}

sealed class HostConfig
{
    public string AccountNickname { get; set; } = "";
    public string OwnerWxId { get; set; } = "";
    public string Token { get; set; } = "";
    public string ApiBase { get; set; } = "http://127.0.0.1:3200/api/";
    public int Port { get; set; } = 3211;
    public bool EnableOcr { get; set; } = true;
    public int ListenIntervalSeconds { get; set; } = 5;
    public bool SendEnabled { get; set; }
    public string ModelsPath { get; set; } = "";
    public string DownloadPath { get; set; } = "";
    public string CapturePath { get; set; } = "";
    public string VideoPath { get; set; } = "";
    public string AccountsConfigPath { get; set; } = "";
    public string AccessibilityStatePath { get; set; } = "";

    public static HostConfig Load(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (!File.Exists(fullPath)) throw new FileNotFoundException("personal WeChat RPA config not found", fullPath);
        var config = JsonSerializer.Deserialize<HostConfig>(File.ReadAllText(fullPath), JsonDefaults.Options) ?? new HostConfig();
        config.SendEnabled = StringComparer.Ordinal.Equals(
            Environment.GetEnvironmentVariable("PERSONAL_WECHAT_SEND")?.Trim(),
            "1");
        var baseDir = Path.GetDirectoryName(fullPath)!;
        config.ModelsPath = Resolve(config.ModelsPath, baseDir, "models");
        config.DownloadPath = Resolve(config.DownloadPath, baseDir, "downloads");
        config.CapturePath = Resolve(config.CapturePath, baseDir, "captures");
        config.VideoPath = Resolve(config.VideoPath, baseDir, "videos");
        config.AccountsConfigPath = Resolve(config.AccountsConfigPath, baseDir, "personal-wechat-accounts.json");
        config.AccessibilityStatePath = Resolve(config.AccessibilityStatePath, baseDir, "personal-wechat-rpa-accessibility-state.json");
        config.ApiBase = config.ApiBase.TrimEnd('/') + "/";
        Directory.CreateDirectory(config.DownloadPath);
        Directory.CreateDirectory(config.CapturePath);
        Directory.CreateDirectory(config.VideoPath);
        return config;
    }

    public void Validate(bool watch)
    {
        if (String.IsNullOrWhiteSpace(AccountNickname)) throw new InvalidOperationException("accountNickname is required");
        if (String.IsNullOrWhiteSpace(OwnerWxId)) throw new InvalidOperationException("ownerWxId is required");
        if (watch && String.IsNullOrWhiteSpace(Token)) throw new InvalidOperationException("token is required for watch mode");
        if (Port is < 1024 or > 65535) throw new InvalidOperationException("port must be between 1024 and 65535");
        if (!Uri.TryCreate(ApiBase, UriKind.Absolute, out var uri) || !(uri.Host is "127.0.0.1" or "localhost"))
            throw new InvalidOperationException("apiBase must be loopback-only");
        if (EnableOcr && !Directory.Exists(ModelsPath)) throw new DirectoryNotFoundException($"OCR models directory not found: {ModelsPath}");
    }

    private static string Resolve(string value, string baseDir, string fallback) =>
        Path.GetFullPath(String.IsNullOrWhiteSpace(value) ? Path.Combine(baseDir, fallback) : Path.IsPathRooted(value) ? value : Path.Combine(baseDir, value));
}

sealed class NarratorAccessibilityScope : IDisposable
{
    private const string RegistryPath = @"Software\Microsoft\Narrator\NoRoam";
    private const string ValueName = "RunningState";
    private readonly string _statePath;
    private readonly bool _originalExists;
    private readonly int _originalValue;
    private int _restored;

    private NarratorAccessibilityScope(string statePath, bool originalExists, int originalValue)
    {
        _statePath = statePath;
        _originalExists = originalExists;
        _originalValue = originalValue;
    }

    public static NarratorAccessibilityScope Enable(string statePath)
    {
        RestoreStaleState(statePath);
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath, writable: true)
            ?? throw new InvalidOperationException("cannot open the current-user accessibility registry key");
        var original = key.GetValue(ValueName);
        var scope = new NarratorAccessibilityScope(statePath, original is not null, original is null ? 0 : Convert.ToInt32(original));
        key.SetValue(ValueName, 1, RegistryValueKind.DWord);
        Directory.CreateDirectory(Path.GetDirectoryName(statePath)!);
        File.WriteAllText(
            statePath,
            JsonSerializer.Serialize(new { pid = Environment.ProcessId, originalExists = scope._originalExists, originalValue = scope._originalValue }, JsonDefaults.Options),
            new UTF8Encoding(false));
        AppDomain.CurrentDomain.ProcessExit += (_, _) => scope.Restore();
        AppDomain.CurrentDomain.UnhandledException += (_, _) => scope.Restore();
        return scope;
    }

    public void Dispose() => Restore();

    private void Restore()
    {
        if (Interlocked.Exchange(ref _restored, 1) != 0) return;
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath, writable: true);
        if (key is not null)
        {
            if (_originalExists) key.SetValue(ValueName, _originalValue, RegistryValueKind.DWord);
            else key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
        if (File.Exists(_statePath)) File.Delete(_statePath);
    }

    private static void RestoreStaleState(string statePath)
    {
        if (!File.Exists(statePath)) return;
        using var document = JsonDocument.Parse(File.ReadAllText(statePath));
        var root = document.RootElement;
        var pid = root.GetProperty("pid").GetInt32();
        try
        {
            using var process = Process.GetProcessById(pid);
            if (!process.HasExited) throw new InvalidOperationException($"another personal WeChat RPA host is already running: {pid}");
        }
        catch (ArgumentException)
        {
            // The recorded host no longer exists; restore its original value below.
        }
        var originalExists = root.GetProperty("originalExists").GetBoolean();
        var originalValue = root.GetProperty("originalValue").GetInt32();
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath, writable: true);
        if (key is not null)
        {
            if (originalExists) key.SetValue(ValueName, originalValue, RegistryValueKind.DWord);
            else key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
        File.Delete(statePath);
    }
}

static class AccountsConfigWriter
{
    private static readonly object Gate = new();

    public static RuntimeIdentity? TryReadLiveIdentity(string filePath, string accountNickname, string ownerWxId)
    {
        lock (Gate)
        {
            if (!File.Exists(filePath)) return null;
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(filePath))?.AsObject();
                var account = (root?["accounts"] as JsonArray)?
                    .OfType<JsonObject>()
                    .SingleOrDefault(item =>
                        StringComparer.Ordinal.Equals(item["accountNickname"]?.GetValue<string>(), accountNickname) &&
                        StringComparer.Ordinal.Equals(item["ownerWxId"]?.GetValue<string>(), ownerWxId));
                if (account is null) return null;

                var processId = account["processId"]?.GetValue<int>() ?? 0;
                var windowHandle = account["windowHandle"]?.GetValue<string>() ?? "";
                var windowsSessionId = account["windowsSessionId"]?.GetValue<int>() ?? -1;
                var processName = account["processName"]?.GetValue<string>() ?? "";
                var executablePath = account["executablePath"]?.GetValue<string>() ?? "";
                if (processId <= 0 || windowHandle.Length == 0 || windowsSessionId < 0 ||
                    !StringComparer.OrdinalIgnoreCase.Equals(processName, "Weixin") ||
                    executablePath.Length == 0)
                    return null;

                using var process = Process.GetProcessById(processId);
                process.Refresh();
                if (process.HasExited || process.SessionId != windowsSessionId ||
                    !StringComparer.OrdinalIgnoreCase.Equals(process.ProcessName, processName) ||
                    !StringComparer.OrdinalIgnoreCase.Equals(process.MainModule?.FileName ?? "", executablePath))
                    return null;
                var liveHandle = NativeWindowActions.FindWeChatWindow(processId);
                if (liveHandle == IntPtr.Zero ||
                    !StringComparer.Ordinal.Equals(liveHandle.ToInt64().ToString(), windowHandle))
                    return null;

                return new RuntimeIdentity(
                    accountNickname,
                    ownerWxId,
                    processId,
                    windowHandle,
                    windowsSessionId,
                    processName,
                    executablePath);
            }
            catch
            {
                return null;
            }
        }
    }

    public static void RefreshIdentity(string filePath, RuntimeIdentity identity)
    {
        lock (Gate)
        {
            if (!File.Exists(filePath)) return;
            var root = JsonNode.Parse(File.ReadAllText(filePath))?.AsObject() ?? new JsonObject();
            var accounts = root["accounts"] as JsonArray;
            if (accounts is null) return;
            var matched = false;
            foreach (var account in accounts.OfType<JsonObject>())
            {
                if (!StringComparer.Ordinal.Equals(account["accountNickname"]?.GetValue<string>(), identity.AccountNickname)) continue;
                if (!StringComparer.Ordinal.Equals(account["ownerWxId"]?.GetValue<string>(), identity.OwnerWxId)) continue;
                ApplyIdentity(account, identity);
                matched = true;
            }
            if (!matched) return;
            WriteAtomic(filePath, root);
        }
    }

    public static void Upsert(string filePath, RuntimeIdentity identity, JsonElement binding, string chatTitle)
    {
        lock (Gate)
        {
            JsonObject root;
            if (File.Exists(filePath)) root = JsonNode.Parse(File.ReadAllText(filePath))?.AsObject() ?? new JsonObject();
            else root = new JsonObject();
            root["version"] = "personal_wechat_accounts_v1";
            var accounts = root["accounts"] as JsonArray ?? new JsonArray();
            root["accounts"] = accounts;
            var accountId = binding.GetProperty("wechatAccountId").GetString()!;
            var physicalAccounts = accounts
                .OfType<JsonObject>()
                .Where(item =>
                    StringComparer.Ordinal.Equals(item["accountNickname"]?.GetValue<string>(), identity.AccountNickname) &&
                    StringComparer.Ordinal.Equals(item["ownerWxId"]?.GetValue<string>(), identity.OwnerWxId))
                .ToList();
            var account = physicalAccounts.SingleOrDefault(item => item["wechatAccountId"]?.GetValue<string>() == accountId)
                ?? physicalAccounts.FirstOrDefault();
            if (account is null)
            {
                account = new JsonObject();
                accounts.Add(account);
            }
            MergePhysicalAccountBindings(accounts, physicalAccounts, account);
            account["wechatAccountId"] = accountId;
            ApplyIdentity(account, identity);
            var conversations = account["conversations"] as JsonArray ?? new JsonArray();
            account["conversations"] = conversations;
            var conversationId = binding.GetProperty("conversationId").GetString()!;
            var conversation = conversations.OfType<JsonObject>().SingleOrDefault(item => item["conversationId"]?.GetValue<string>() == conversationId);
            if (conversation is null)
            {
                conversation = new JsonObject();
                conversations.Add(conversation);
            }
            conversation["conversationId"] = conversationId;
            conversation["customerId"] = binding.GetProperty("customerId").GetString();
            conversation["chatTitle"] = chatTitle;
            WriteAtomic(filePath, root);
        }
    }

    private static void MergePhysicalAccountBindings(JsonArray accounts, List<JsonObject> physicalAccounts, JsonObject target)
    {
        var merged = new JsonArray();
        var conversationIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var account in physicalAccounts.Prepend(target).Distinct())
        {
            if (account["conversations"] is not JsonArray conversations) continue;
            foreach (var conversation in conversations.OfType<JsonObject>())
            {
                var conversationId = conversation["conversationId"]?.GetValue<string>() ?? "";
                if (conversationId.Length == 0 || !conversationIds.Add(conversationId)) continue;
                merged.Add(conversation.DeepClone());
            }
        }
        target["conversations"] = merged;
        foreach (var duplicate in physicalAccounts.Where(item => !ReferenceEquals(item, target)).ToList())
        {
            accounts.Remove(duplicate);
        }
    }

    private static void ApplyIdentity(JsonObject account, RuntimeIdentity identity)
    {
        account["sessionId"] = $"{identity.OwnerWxId}:{identity.ProcessId}:{identity.WindowHandle}";
        account["processId"] = identity.ProcessId;
        account["windowHandle"] = identity.WindowHandle;
        account["windowsSessionId"] = identity.WindowsSessionId;
        account["processName"] = identity.ProcessName;
        account["executablePath"] = identity.ExecutablePath;
        account["accountText"] = identity.AccountNickname;
        account["accountNickname"] = identity.AccountNickname;
        account["ownerWxId"] = identity.OwnerWxId;
    }

    private static void WriteAtomic(string filePath, JsonObject root)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        var temp = filePath + ".tmp";
        File.WriteAllText(temp, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
        File.Move(temp, filePath, true);
    }
}

sealed record HostArguments(bool Inspect, bool Profiles, bool Probe, bool OcrProbe, bool OcrWatch, bool Watch, bool Help, string ConfigPath)
{
    public static HostArguments Parse(string[] args)
    {
        var inspect = args.Contains("--inspect");
        var profiles = args.Contains("--profiles");
        var probe = args.Contains("--probe");
        var ocrProbe = args.Contains("--ocr-probe");
        var ocrWatch = args.Contains("--ocr-watch");
        var watch = args.Contains("--watch");
        var help = args.Contains("--help") || args.Contains("-h");
        var configIndex = Array.IndexOf(args, "--config");
        var config = configIndex >= 0 && configIndex + 1 < args.Length
            ? args[configIndex + 1]
            : Environment.GetEnvironmentVariable("PERSONAL_WECHAT_RPA_CONFIG_FILE") ?? Path.Combine(Environment.CurrentDirectory, ".runtime", "personal-wechat-rpa.json");
        return new HostArguments(inspect, profiles, probe, ocrProbe, ocrWatch, watch, help, config);
    }
}

static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
    };
}
