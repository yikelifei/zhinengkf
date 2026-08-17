using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Net;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;
using WeChatAuto.Services;
using WeChatAuto.Utils;

sealed class OcrRpaHost
{
    private const string EventVersion = "personal_wechat_rpa_event_v1";
    private readonly HostConfig _config;
    private readonly OCRService _ocr;
    private readonly RuntimeIdentity _identity;
    private readonly CancellationToken _token;
    private readonly HttpClient _api;
    private readonly SemaphoreSlim _interactionLock = new(1, 1);
    private readonly Channel<InboundEvent> _inbound = Channel.CreateBounded<InboundEvent>(new BoundedChannelOptions(200)
    {
        SingleReader = true,
        SingleWriter = true,
        FullMode = BoundedChannelFullMode.DropOldest,
    });
    private readonly ConcurrentDictionary<string, string> _lastInboundByChat = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, string> _lastObservationByChat = new(StringComparer.Ordinal);
    private List<OcrUnreadBadge> _previousBadges = [];
    private string _currentContentSignature = "";
    private string _currentChatTitle = "";
    private int _detectedInboundCount;
    private int _postedInboundCount;
    private string? _lastError;

    public OcrRpaHost(HostConfig config, OCRService ocr, RuntimeIdentity identity, CancellationToken token)
    {
        _config = config;
        _ocr = ocr;
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

        await EstablishBaselineAsync();
        var postTask = PostInboundLoopAsync();
        var httpTask = HttpLoopAsync(listener);
        var monitorTask = MonitorLoopAsync();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            status = "watching",
            automation = "ocr_rpa",
            endpoint = $"http://127.0.0.1:{_config.Port}",
            sendEnabled = _config.SendEnabled,
            target = _identity,
            baselineChatTitle = _currentChatTitle,
            baselineUnreadBadgeCount = _previousBadges.Count,
        }, JsonDefaults.Options));

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
            _inbound.Writer.TryComplete();
            _api.Dispose();
        }
    }

    private async Task EstablishBaselineAsync()
    {
        await _interactionLock.WaitAsync(_token);
        try
        {
            using var capture = OcrWindowCapture.Capture(_identity, focusIfNeeded: true);
            _previousBadges = OcrLayoutAnalyzer.FindUnreadBadges(capture.Bitmap);
            _currentContentSignature = OcrLayoutAnalyzer.ContentSignature(capture.Bitmap);
            SaveCapture(capture.Bitmap, "ocr-watch-baseline");
            var observation = OcrLayoutAnalyzer.Observe(_ocr, capture.Bitmap);
            if (observation is not null)
            {
                _currentChatTitle = observation.ChatTitle;
                _lastObservationByChat[observation.ChatTitle] = observation.Fingerprint;
            }
        }
        finally
        {
            _interactionLock.Release();
        }
    }

    private async Task MonitorLoopAsync()
    {
        while (!_token.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(_config.ListenIntervalSeconds), _token);
            await _interactionLock.WaitAsync(_token);
            try
            {
                using var capture = OcrWindowCapture.Capture(_identity, focusIfNeeded: false);
                var currentBadges = OcrLayoutAnalyzer.FindUnreadBadges(capture.Bitmap);
                var changedBadge = OcrLayoutAnalyzer.FindChangedBadge(_previousBadges, currentBadges);
                var currentContentSignature = OcrLayoutAnalyzer.ContentSignature(capture.Bitmap);
                var currentChatChanged = !StringComparer.Ordinal.Equals(_currentContentSignature, currentContentSignature);
                _previousBadges = currentBadges;
                if (changedBadge is null)
                {
                    if (!currentChatChanged) continue;

                    SaveCapture(capture.Bitmap, "ocr-current-chat-candidate");
                    var currentObservation = OcrLayoutAnalyzer.Observe(_ocr, capture.Bitmap);
                    if (currentObservation is not null) _currentContentSignature = currentContentSignature;
                    if (currentObservation is null) continue;
                    TryRecordObservation(currentObservation);
                    continue;
                }

                OcrWindowCapture.Focus(_identity);
                Mouse.Position = new Point(
                    capture.ScreenBounds.Left + OcrLayoutAnalyzer.ChatListClickX(capture.Bitmap.Width),
                    capture.ScreenBounds.Top + changedBadge.CenterY);
                Mouse.LeftClick();
                await Task.Delay(900, _token);

                using var selected = OcrWindowCapture.Capture(_identity, focusIfNeeded: true);
                SaveCapture(selected.Bitmap, "ocr-inbound-candidate");
                _previousBadges = OcrLayoutAnalyzer.FindUnreadBadges(selected.Bitmap);
                _currentContentSignature = OcrLayoutAnalyzer.ContentSignature(selected.Bitmap);
                var observation = OcrLayoutAnalyzer.Observe(_ocr, selected.Bitmap);
                if (observation is null) continue;
                TryRecordObservation(observation);
            }
            catch (Exception error) when (!_token.IsCancellationRequested)
            {
                _lastError = error.Message;
                Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, code = "ocr_monitor_failed", errorMessage = error.Message }, JsonDefaults.Options));
            }
            finally
            {
                _interactionLock.Release();
            }
        }
    }

    private async Task ScanCurrentChatAsync()
    {
        await _interactionLock.WaitAsync(_token);
        try
        {
            using var capture = OcrWindowCapture.Capture(_identity, focusIfNeeded: true);
            SaveCapture(capture.Bitmap, "ocr-manual-current-chat");
            _previousBadges = OcrLayoutAnalyzer.FindUnreadBadges(capture.Bitmap);
            _currentContentSignature = OcrLayoutAnalyzer.ContentSignature(capture.Bitmap);
            var observation = OcrLayoutAnalyzer.Observe(_ocr, capture.Bitmap);
            if (observation is not null) TryRecordObservation(observation, force: true);
        }
        finally
        {
            _interactionLock.Release();
        }
    }

    private bool TryRecordObservation(OcrChatObservation observation, bool force = false)
    {
        if (OcrLayoutAnalyzer.IsSystemConversation(observation.ChatTitle)) return false;

        _currentChatTitle = observation.ChatTitle;
        if (!force &&
            _lastObservationByChat.TryGetValue(observation.ChatTitle, out var previous) &&
            StringComparer.Ordinal.Equals(previous, observation.Fingerprint))
        {
            return false;
        }

        RememberObservation(observation);
        var externalId = Sha256(String.Join("\n", _identity.OwnerWxId, observation.ChatTitle, observation.Message, observation.Fingerprint));
        var inbound = new InboundEvent(
            EventVersion,
            _identity.AccountNickname,
            _identity.OwnerWxId,
            observation.ChatTitle,
            observation.ConversationType,
            observation.ChatTitle,
            observation.Message,
            "text",
            externalId,
            DateTimeOffset.Now.ToString("O"),
            [],
            "ocr_verified_bubble");
        _detectedInboundCount++;
        _inbound.Writer.TryWrite(inbound);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            eventName = "ocr_inbound_detected",
            chatTitle = observation.ChatTitle,
            message = observation.Message,
            externalId,
        }, JsonDefaults.Options));
        return true;
    }

    private void RememberObservation(OcrChatObservation observation)
    {
        _currentChatTitle = observation.ChatTitle;
        _lastObservationByChat[observation.ChatTitle] = observation.Fingerprint;
        _lastInboundByChat[observation.ChatTitle] = observation.Message;
    }

    private async Task PostInboundLoopAsync()
    {
        await foreach (var item in _inbound.Reader.ReadAllAsync(_token))
        {
            try
            {
                using var response = await _api.PostAsJsonAsync("personal-wechat-rpa/inbound", item, JsonDefaults.Options, _token);
                var body = await response.Content.ReadAsStringAsync(_token);
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException($"API rejected inbound event: {(int)response.StatusCode} {body}");
                using var document = JsonDocument.Parse(body);
                if (document.RootElement.TryGetProperty("binding", out var binding))
                    AccountsConfigWriter.Upsert(_config.AccountsConfigPath, _identity, binding, item.ChatTitle);
                _postedInboundCount++;
            }
            catch (Exception error) when (!_token.IsCancellationRequested)
            {
                _lastError = error.Message;
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
                await RespondAsync(context, 200, new
                {
                    ok = true,
                    status = "watching",
                    automation = "ocr_rpa",
                    sendEnabled = _config.SendEnabled,
                    detectedInboundCount = _detectedInboundCount,
                    postedInboundCount = _postedInboundCount,
                    currentChatTitle = _currentChatTitle,
                    lastError = _lastError,
                    target = _identity,
                });
                return;
            }
            if (context.Request.HttpMethod == "POST" && route == "/probe")
            {
                await RespondAsync(context, 200, new { ok = true, accountVerified = true, automation = "ocr_rpa", target = _identity });
                return;
            }
            if (context.Request.HttpMethod == "POST" && route == "/scan-current")
            {
                await ScanCurrentChatAsync();
                await RespondAsync(context, 200, new
                {
                    ok = true,
                    detectedInboundCount = _detectedInboundCount,
                    postedInboundCount = _postedInboundCount,
                    currentChatTitle = _currentChatTitle,
                });
                return;
            }
            if (context.Request.HttpMethod == "POST" && route == "/open-chat")
            {
                using var document = await JsonDocument.ParseAsync(context.Request.InputStream, cancellationToken: _token);
                var chatTitle = document.RootElement.TryGetProperty("chatTitle", out var titleElement)
                    ? titleElement.GetString()?.Trim() ?? ""
                    : "";
                var result = await OpenChatAsync(chatTitle);
                await RespondAsync(context, result.Ok ? 200 : 409, result);
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

    private async Task<ChatPreparationResult> OpenChatAsync(string chatTitle)
    {
        if (!_config.SendEnabled)
            return ChatPreparationResult.Fail("real_send_disabled", "PERSONAL_WECHAT_SEND is not 1");
        if (chatTitle.Length == 0)
            return ChatPreparationResult.Fail("chat_title_missing", "chat title is required");

        await _interactionLock.WaitAsync(_token);
        try
        {
            Point searchPoint;
            using (var focusedCapture = OcrWindowCapture.Capture(_identity, focusIfNeeded: true))
            {
                var currentTitle = OcrLayoutAnalyzer.ReadChatTitle(_ocr, focusedCapture.Bitmap);
                if (StringComparer.Ordinal.Equals(currentTitle, chatTitle))
                {
                    var currentObservation = OcrLayoutAnalyzer.Observe(_ocr, focusedCapture.Bitmap);
                    SaveCapture(focusedCapture.Bitmap, "ocr-open-chat-verified");
                    if (currentObservation is not null)
                        RememberObservation(currentObservation);
                    return new ChatPreparationResult(
                        true,
                        null,
                        null,
                        currentTitle,
                        currentObservation?.Message ?? "");
                }
                var chatListWidth = OcrLayoutAnalyzer.ChatPaneLeft(focusedCapture.Bitmap.Width);
                searchPoint = new Point(
                    focusedCapture.ScreenBounds.Left + Math.Clamp(chatListWidth / 2, 110, chatListWidth - 70),
                    focusedCapture.ScreenBounds.Top + 55);
            }
            // WeChat 4.x no longer consistently focuses the global search box with Ctrl+F.
            // Click the visible search field in the bound window, then replace its contents.
            Mouse.Position = searchPoint;
            Mouse.LeftClick();
            await Task.Delay(180, _token);
            Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_A);
            ClipboardHelper.SetText(chatTitle);
            Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_V);
            await Task.Delay(750, _token);
            Keyboard.Type(VirtualKeyShort.ENTER);

            OcrChatObservation? observation = null;
            for (var attempt = 0; attempt < 8; attempt++)
            {
                await Task.Delay(450, _token);
                using var capture = OcrWindowCapture.Capture(_identity, focusIfNeeded: true);
                observation = OcrLayoutAnalyzer.Observe(_ocr, capture.Bitmap);
                if (observation is not null &&
                    StringComparer.Ordinal.Equals(observation.ChatTitle, chatTitle))
                {
                    SaveCapture(capture.Bitmap, "ocr-open-chat-verified");
                    break;
                }
                if (attempt == 7) SaveCapture(capture.Bitmap, "ocr-open-chat-mismatch");
            }

            if (observation is null || !StringComparer.Ordinal.Equals(observation.ChatTitle, chatTitle))
                return ChatPreparationResult.Fail("chat_title_mismatch", "the requested chat was not opened and verified");

            RememberObservation(observation);
            return new ChatPreparationResult(
                true,
                null,
                null,
                observation.ChatTitle,
                observation.Message);
        }
        catch (Exception error)
        {
            return ChatPreparationResult.Fail("open_chat_failed", error.Message);
        }
        finally
        {
            _interactionLock.Release();
        }
    }

    private async Task<SendResult> SendAsync(JsonElement operation)
    {
        if (!_config.SendEnabled)
            return SendResult.Fail("real_send_disabled", "PERSONAL_WECHAT_SEND is not 1");
        await _interactionLock.WaitAsync(_token);
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
            if (!accountVerified)
                return SendResult.Fail("account_identity_mismatch", "runtime account/process/window/session does not match the bound dispatch", accountVerified: false);
            if (expected.GetProperty("accountText").GetString() != _identity.AccountNickname)
                return SendResult.Fail("account_text_mismatch", "expected account text does not match the dedicated account");
            if (chatTitle.Length == 0)
                return SendResult.Fail("chat_title_missing", "chat title is required");
            if (!_lastInboundByChat.TryGetValue(chatTitle, out var observedRecent) || !StringComparer.Ordinal.Equals(observedRecent, recentMessage))
                return SendResult.Fail("recent_message_mismatch", "the expected recent customer message was not observed by this OCR host");
            if (actions.GetArrayLength() == 0)
                return SendResult.Fail("actions_missing", "at least one action is required");

            using var beforeCapture = OcrWindowCapture.Capture(_identity, focusIfNeeded: true);
            var before = OcrLayoutAnalyzer.Observe(_ocr, beforeCapture.Bitmap);
            if (before is null || !StringComparer.Ordinal.Equals(before.ChatTitle, chatTitle))
                return SendResult.Fail("chat_title_mismatch", "the visible chat title does not match the bound conversation");
            if (!StringComparer.Ordinal.Equals(before.Message, recentMessage))
                return SendResult.Fail("recent_message_mismatch", "the visible recent message changed before send");

            var verified = 0;
            foreach (var action in actions.EnumerateArray())
            {
                var type = action.GetProperty("type").GetString();
                if (type != "text")
                    return SendResult.Fail("unsupported_action", $"OCR RPA currently supports text only, not: {type}", verified);
                var text = action.GetProperty("text").GetString()?.Trim() ?? "";
                if (text.Length == 0)
                    return SendResult.Fail("text_missing", "text action is empty", verified);

                var beforeOutgoingCount = OcrLayoutAnalyzer.CountOutgoingText(before.Blocks, beforeCapture.Bitmap.Width, text);
                var chatLeft = OcrLayoutAnalyzer.ChatPaneLeft(beforeCapture.Bitmap.Width);
                Mouse.Position = new Point(
                    beforeCapture.ScreenBounds.Left + chatLeft + (beforeCapture.Bitmap.Width - chatLeft) / 2,
                    beforeCapture.ScreenBounds.Top + beforeCapture.Bitmap.Height - 65);
                Mouse.LeftClick();
                ClipboardHelper.SetText(text);
                Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_V);
                await Task.Delay(200, _token);
                Keyboard.Type(VirtualKeyShort.ENTER);

                var observed = false;
                for (var attempt = 0; attempt < 6; attempt++)
                {
                    await Task.Delay(800, _token);
                    using var afterCapture = OcrWindowCapture.Capture(_identity, focusIfNeeded: true);
                    var afterBlocks = OcrLayoutAnalyzer.DetectPaneBlocks(_ocr, afterCapture.Bitmap);
                    if (OcrLayoutAnalyzer.CountOutgoingText(afterBlocks, afterCapture.Bitmap.Width, text) > beforeOutgoingCount)
                    {
                        observed = true;
                        break;
                    }
                }
                if (!observed)
                    return SendResult.Fail("send_not_observed", "the outgoing text was not observed after the send keystroke; state is uncertain and will not be retried", verified);
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
            _interactionLock.Release();
        }
    }

    private string SaveCapture(Bitmap bitmap, string prefix)
    {
        Directory.CreateDirectory(_config.CapturePath);
        var path = Path.Combine(_config.CapturePath, $"{prefix}-{_identity.ProcessId}-{DateTime.Now:yyyyMMdd-HHmmssfff}.png");
        bitmap.Save(path, ImageFormat.Png);
        return path;
    }

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

    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}

sealed record OcrChatObservation(
    string ChatTitle,
    string ConversationType,
    string Message,
    string Fingerprint,
    IReadOnlyList<OcrTextBlock> Blocks);

sealed record OcrTextBlock(string Text, int Left, int Top, int Right, int Bottom)
{
    public int CenterX => Left + (Right - Left) / 2;
    public int CenterY => Top + (Bottom - Top) / 2;
}

sealed record ChatPreparationResult(
    bool Ok,
    string? Code,
    string? ErrorMessage,
    string ChatTitle,
    string RecentMessage)
{
    public static ChatPreparationResult Fail(string code, string message) =>
        new(false, code, message, "", "");
}

sealed record OcrUnreadBadge(int CenterY, string Signature);

static class OcrLayoutAnalyzer
{
    private static readonly object OcrGate = new();
    private static readonly HashSet<string> SystemConversations = new(StringComparer.OrdinalIgnoreCase)
    {
        "腾讯新闻", "微信团队", "文件传输助手", "服务通知", "订阅号消息",
    };

    public static int ChatPaneLeft(int width) => Math.Clamp(370, 300, Math.Max(301, width - 500));

    public static int ChatListClickX(int width) => Math.Clamp((int)Math.Round(width * 0.18), 130, ChatPaneLeft(width) - 80);

    public static bool IsSystemConversation(string chatTitle) => SystemConversations.Contains(chatTitle.Trim());

    public static List<OcrUnreadBadge> FindUnreadBadges(Bitmap bitmap)
    {
        var xStart = Math.Clamp((int)Math.Round(bitmap.Width * 0.27), 1, bitmap.Width - 2);
        var xEnd = Math.Clamp(ChatPaneLeft(bitmap.Width) - 4, xStart + 1, bitmap.Width - 1);
        var rows = new List<int>();
        for (var y = 65; y < bitmap.Height - 35; y++)
        {
            var redPixels = 0;
            for (var x = xStart; x < xEnd; x++)
            {
                var pixel = bitmap.GetPixel(x, y);
                if (pixel.R >= 190 && pixel.G <= 125 && pixel.B <= 135 && pixel.R - Math.Max(pixel.G, pixel.B) >= 70)
                    redPixels++;
            }
            if (redPixels >= 2) rows.Add(y);
        }

        var result = new List<OcrUnreadBadge>();
        for (var index = 0; index < rows.Count;)
        {
            var first = rows[index];
            var last = first;
            index++;
            while (index < rows.Count && rows[index] - last <= 3)
            {
                last = rows[index];
                index++;
            }
            if (last - first is < 3 or > 28) continue;
            var centerY = (first + last) / 2;
            result.Add(new OcrUnreadBadge(centerY, RegionSignature(bitmap, xStart, Math.Max(0, centerY - 14), xEnd - xStart, 29, step: 2)));
        }
        return result;
    }

    public static OcrUnreadBadge? FindChangedBadge(IReadOnlyList<OcrUnreadBadge> previous, IReadOnlyList<OcrUnreadBadge> current)
    {
        foreach (var badge in current.OrderBy(item => item.CenterY))
        {
            var old = previous.OrderBy(item => Math.Abs(item.CenterY - badge.CenterY)).FirstOrDefault();
            if (old is null || Math.Abs(old.CenterY - badge.CenterY) > 8 || !StringComparer.Ordinal.Equals(old.Signature, badge.Signature))
                return badge;
        }
        return null;
    }

    public static OcrChatObservation? Observe(OCRService ocr, Bitmap bitmap)
    {
        var blocks = DetectPaneBlocks(ocr, bitmap);
        var chatLeft = ChatPaneLeft(bitmap.Width);
        var paneWidth = bitmap.Width - chatLeft;
        var title = ReadChatTitle(blocks, bitmap.Width);
        if (title.Length == 0) return null;

        var incomingRightEdge = chatLeft + (int)(paneWidth * 0.60);
        var incomingLeftEdge = chatLeft + Math.Max(42, (int)(paneWidth * 0.055));
        var incomingAnchorEdge = chatLeft + (int)(paneWidth * 0.38);
        var messageBlock = blocks
            .Where(block => block.Top >= 88 && block.Bottom <= bitmap.Height - 135)
            .Where(block =>
                block.Left >= incomingLeftEdge &&
                block.Left <= incomingAnchorEdge &&
                block.CenterX <= incomingRightEdge)
            .Where(block => IsUsefulMessage(block.Text))
            .OrderByDescending(block => block.Bottom)
            .ThenBy(block => block.Left)
            .FirstOrDefault();
        if (messageBlock is null) return null;

        // OCR also sees words printed inside photos and file previews. Preserve the
        // existence of that real non-text bubble without inventing those words as
        // a customer message.
        var message = IsLikelyPlainTextBubble(bitmap, messageBlock)
            ? messageBlock.Text.Trim()
            : "[非文本消息]";
        var conversationType = title.Contains('(') || title.Contains('（') || title.Contains("群", StringComparison.Ordinal)
            ? "group"
            : "direct";
        var fingerprint = Hash(String.Join("\n", title, message, messageBlock.Left / 8, messageBlock.Top / 8, ContentSignature(bitmap)));
        return new OcrChatObservation(title, conversationType, message, fingerprint, blocks);
    }

    public static string ReadChatTitle(OCRService ocr, Bitmap bitmap)
    {
        return ReadChatTitle(DetectPaneBlocks(ocr, bitmap), bitmap.Width);
    }

    private static string ReadChatTitle(IReadOnlyList<OcrTextBlock> blocks, int bitmapWidth)
    {
        var chatLeft = ChatPaneLeft(bitmapWidth);
        var paneWidth = bitmapWidth - chatLeft;
        return blocks
            .Where(block => block.Top >= 28 && block.Bottom <= 92 && block.Left >= chatLeft + 4 && block.Left < chatLeft + Math.Min(360, paneWidth / 2))
            .Where(block => IsUsefulTitle(block.Text))
            .OrderBy(block => block.Left)
            .ThenBy(block => block.Top)
            .Select(block => block.Text.Trim())
            .FirstOrDefault() ?? "";
    }

    public static IReadOnlyList<OcrTextBlock> DetectPaneBlocks(OCRService ocr, Bitmap bitmap)
    {
        var chatLeft = ChatPaneLeft(bitmap.Width);
        var cropBounds = new Rectangle(chatLeft, 25, bitmap.Width - chatLeft, Math.Max(1, bitmap.Height - 145));
        using var crop = bitmap.Clone(cropBounds, PixelFormat.Format24bppRgb);
        lock (OcrGate)
        {
            var originalOut = Console.Out;
            try
            {
                Console.SetOut(TextWriter.Null);
                var detected = ocr.Detect(
                    crop,
                    padding: 0,
                    maxSideLen: Math.Max(crop.Width, crop.Height),
                    boxScoreThresh: 0.3f,
                    boxThresh: 0.3f,
                    unClipRatio: 1.6f,
                    doAngle: false,
                    mostAngle: false,
                    isTest: false);
                return detected.TextBlocks
                    .Where(block => !String.IsNullOrWhiteSpace(block.Text) && block.BoxPoints.Count > 0)
                    .Select(block => new OcrTextBlock(
                        block.Text.Trim(),
                        cropBounds.Left + block.BoxPoints.Min(point => point.X),
                        cropBounds.Top + block.BoxPoints.Min(point => point.Y),
                        cropBounds.Left + block.BoxPoints.Max(point => point.X),
                        cropBounds.Top + block.BoxPoints.Max(point => point.Y)))
                    .ToList();
            }
            finally
            {
                Console.SetOut(originalOut);
            }
        }
    }

    public static int CountOutgoingText(IReadOnlyList<OcrTextBlock> blocks, int bitmapWidth, string expected)
    {
        var chatLeft = ChatPaneLeft(bitmapWidth);
        var outgoingStart = chatLeft + (int)((bitmapWidth - chatLeft) * 0.52);
        var normalizedExpected = NormalizeText(expected);
        return blocks.Count(block =>
            block.CenterX >= outgoingStart &&
            NormalizeText(block.Text).Contains(normalizedExpected, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsLikelyPlainTextBubble(Bitmap bitmap, OcrTextBlock block)
    {
        var left = Math.Max(0, block.Left - 12);
        var top = Math.Max(0, block.Top - 10);
        var right = Math.Min(bitmap.Width - 1, block.Right + 12);
        var bottom = Math.Min(bitmap.Height - 1, block.Bottom + 10);
        var total = 0;
        var neutral = 0;
        var dark = 0;
        var light = 0;
        for (var y = top; y <= bottom; y += 2)
        for (var x = left; x <= right; x += 2)
        {
            var pixel = bitmap.GetPixel(x, y);
            var maximum = Math.Max(pixel.R, Math.Max(pixel.G, pixel.B));
            var minimum = Math.Min(pixel.R, Math.Min(pixel.G, pixel.B));
            var luminance = (pixel.R * 299 + pixel.G * 587 + pixel.B * 114) / 1000;
            total++;
            if (maximum - minimum <= 28) neutral++;
            if (luminance <= 115) dark++;
            if (luminance >= 150) light++;
        }
        if (total == 0) return false;

        var chatLeft = ChatPaneLeft(bitmap.Width);
        var headerPixel = bitmap.GetPixel(
            chatLeft + (bitmap.Width - chatLeft) / 2,
            Math.Min(60, bitmap.Height - 1));
        var headerLuminance = (headerPixel.R * 299 + headerPixel.G * 587 + headerPixel.B * 114) / 1000;
        var neutralRatio = (double)neutral / total;
        return headerLuminance < 128
            ? neutralRatio >= 0.72 && (double)dark / total >= 0.65
            : neutralRatio >= 0.72 && (double)light / total >= 0.65;
    }

    private static bool IsUsefulTitle(string value)
    {
        var text = value.Trim();
        if (text.Length is < 1 or > 80) return false;
        if (text.All(character => Char.IsDigit(character) || Char.IsPunctuation(character) || Char.IsWhiteSpace(character))) return false;
        return !text.Contains("条新消息", StringComparison.Ordinal) && text is not "微信";
    }

    private static bool IsUsefulMessage(string value)
    {
        var text = value.Trim();
        if (text.Length == 0) return false;
        if (!text.Any(Char.IsLetterOrDigit)) return false;
        if (System.Text.RegularExpressions.Regex.IsMatch(
                text,
                @"^(?:(?:昨天|今天|星期[一二三四五六日天])\s*)?\d{1,2}:\d{2}$"))
            return false;
        if (System.Text.RegularExpressions.Regex.IsMatch(
                text,
                @"^\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB|K|M|G|T|字节)$",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            return false;
        if (System.Text.RegularExpressions.Regex.IsMatch(text, @"^\d+条新消息$")) return false;
        if (text.StartsWith("RPA入站测试", StringComparison.OrdinalIgnoreCase)) return false;
        return text is not "查看更多消息"
            and not "以下为新消息"
            and not "查看原图"
            and not "撤回了一条消息";
    }

    public static string ContentSignature(Bitmap bitmap) => RegionSignature(
        bitmap,
        ChatPaneLeft(bitmap.Width) + 10,
        90,
        bitmap.Width - ChatPaneLeft(bitmap.Width) - 20,
        Math.Max(1, bitmap.Height - 245),
        step: 12);

    private static string RegionSignature(Bitmap bitmap, int left, int top, int width, int height, int step)
    {
        var right = Math.Min(bitmap.Width, left + Math.Max(1, width));
        var bottom = Math.Min(bitmap.Height, top + Math.Max(1, height));
        using var stream = new MemoryStream();
        for (var y = Math.Max(0, top); y < bottom; y += step)
        for (var x = Math.Max(0, left); x < right; x += step)
        {
            var pixel = bitmap.GetPixel(x, y);
            stream.WriteByte((byte)((pixel.R & 0xF0) | (pixel.G >> 4)));
            stream.WriteByte((byte)(pixel.B >> 4));
        }
        return Convert.ToHexString(SHA256.HashData(stream.ToArray())).ToLowerInvariant();
    }

    private static string NormalizeText(string value) => String.Concat(value.Where(character => !Char.IsWhiteSpace(character)))
        .Replace("，", ",", StringComparison.Ordinal)
        .Replace("。", ".", StringComparison.Ordinal);

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}

sealed class OcrWindowCapture : IDisposable
{
    public Bitmap Bitmap { get; }
    public Rectangle ScreenBounds { get; }

    private OcrWindowCapture(Bitmap bitmap, Rectangle screenBounds)
    {
        Bitmap = bitmap;
        ScreenBounds = screenBounds;
    }

    public static OcrWindowCapture Capture(RuntimeIdentity identity, bool focusIfNeeded)
    {
        var handle = new IntPtr(Int64.Parse(identity.WindowHandle));
        ValidateRuntime(identity, handle);
        if (focusIfNeeded && GetForegroundWindow() != handle)
            Focus(identity);
        if (!GetWindowRect(handle, out var rect))
            throw new InvalidOperationException("cannot read the bound WeChat window bounds");
        var bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
        if (bounds.Width < 900 || bounds.Height < 600)
            throw new InvalidOperationException($"unsupported WeChat window size: {bounds.Width}x{bounds.Height}; keep the dedicated window at least 900x600");

        var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        var printed = false;
        using (var graphics = Graphics.FromImage(bitmap))
        {
            var hdc = graphics.GetHdc();
            try { printed = PrintWindow(handle, hdc, 2); }
            finally { graphics.ReleaseHdc(hdc); }
        }
        if (!printed || LooksBlank(bitmap))
        {
            bitmap.Dispose();
            if (!focusIfNeeded) throw new InvalidOperationException("background WeChat capture is unavailable while the target window is covered");
            Focus(identity);
            Thread.Sleep(350);
            bitmap = OCRService.CaptureRect(bounds);
        }
        return new OcrWindowCapture(bitmap, bounds);
    }

    public static void Focus(RuntimeIdentity identity)
    {
        var handle = new IntPtr(Int64.Parse(identity.WindowHandle));
        ValidateRuntime(identity, handle);
        ForceForeground(handle);
    }

    public void Dispose() => Bitmap.Dispose();

    private static void ValidateRuntime(RuntimeIdentity identity, IntPtr handle)
    {
        using var process = Process.GetProcessById(identity.ProcessId);
        if (process.HasExited || process.SessionId != identity.WindowsSessionId)
            throw new InvalidOperationException("bound WeChat process/session is no longer active");
        GetWindowThreadProcessId(handle, out var ownerProcessId);
        if (ownerProcessId != (uint)identity.ProcessId || !StringComparer.Ordinal.Equals(GetWindowTitle(handle).Trim(), "微信"))
            throw new InvalidOperationException("bound WeChat window handle/title changed; re-run account verification");
    }

    private static void ForceForeground(IntPtr handle)
    {
        ShowWindow(handle, 9);
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 0x0002, UIntPtr.Zero);

        var foreground = GetForegroundWindow();
        var currentThread = GetCurrentThreadId();
        var foregroundThread = GetWindowThreadProcessId(foreground, out _);
        var targetThread = GetWindowThreadProcessId(handle, out _);

        if (foregroundThread != 0) AttachThreadInput(currentThread, foregroundThread, true);
        if (targetThread != 0) AttachThreadInput(currentThread, targetThread, true);
        try
        {
            BringWindowToTop(handle);
            SetForegroundWindow(handle);
        }
        finally
        {
            if (targetThread != 0) AttachThreadInput(currentThread, targetThread, false);
            if (foregroundThread != 0) AttachThreadInput(currentThread, foregroundThread, false);
        }

        Thread.Sleep(350);
    }

    private static string GetWindowTitle(IntPtr handle)
    {
        var length = GetWindowTextLength(handle);
        if (length <= 0) return "";
        var buffer = new StringBuilder(length + 1);
        GetWindowText(handle, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private static bool LooksBlank(Bitmap bitmap)
    {
        var samples = new HashSet<int>();
        for (var y = 10; y < bitmap.Height; y += Math.Max(20, bitmap.Height / 12))
        for (var x = 10; x < bitmap.Width; x += Math.Max(20, bitmap.Width / 16))
            samples.Add(bitmap.GetPixel(x, y).ToArgb());
        return samples.Count < 6;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr handle, out NativeRect rect);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr handle, IntPtr deviceContext, uint flags);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr handle, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attachThreadId, uint attachToThreadId, bool attach);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr handle, StringBuilder buffer, int maximumCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr handle);
}
