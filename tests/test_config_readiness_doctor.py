import base64
import json

from scripts.config_readiness_doctor import build_report


def _write_project(tmp_path, settings):
    config_dir = tmp_path / "config"
    desktop_dir = tmp_path / "desktop"
    config_dir.mkdir()
    desktop_dir.mkdir()
    (config_dir / "settings.yaml").write_text(settings, encoding="utf-8")
    (tmp_path / ".env.example").write_text("CUSTOM_API_KEY=replace-me\n", encoding="utf-8")
    (desktop_dir / ".env.example").write_text("API_PORT=3200\n", encoding="utf-8")


def _component(report, component_id):
    return next(item for item in report["components"] if item["id"] == component_id)


def test_doctor_reports_all_components_ready_without_exposing_secrets(tmp_path):
    _write_project(
        tmp_path,
        """
ai_engine:
  enabled: true
  primary: custom_api_1
  fallback_chain: []
  providers:
    custom_api_1:
      enabled: true
      api_key: ${CUSTOM_API_KEY}
      base_url: ${CUSTOM_API_BASE}
      model: ${CUSTOM_API_MODEL}
      request_format: openai
      temperature: 0.4
      max_tokens: 300
""".lstrip(),
    )
    aes_key = base64.b64encode(b"a" * 32).decode("ascii").rstrip("=")
    environment = {
        "CUSTOM_API_KEY": "model-secret-sentinel",
        "CUSTOM_API_BASE": "https://provider.invalid/v1",
        "CUSTOM_API_MODEL": "model-one",
        "WECHAT_SEND_ADAPTER": "windows_bridge",
        "PERSONAL_WECHAT_BRIDGE": "1",
        "PERSONAL_WECHAT_SEND": "1",
        "PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW": "1",
        "PERSONAL_WECHAT_AUTO_ENTER": "1",
        "WECHAT_WORK_CORP_ID": "corp-id",
        "WECHAT_WORK_AGENT_ID": "100001",
        "WECHAT_WORK_SECRET": "wecom-secret-sentinel",
        "WECHAT_WORK_TOKEN": "wecom-token-sentinel",
        "WECHAT_WORK_ENCODING_AES_KEY": aes_key,
        "WECHAT_WORK_OPEN_KFID": "wkf-id",
        "WECHAT_WORK_DEFAULT_CONVERSATION_ID": "conversation-id",
    }

    report = build_report(tmp_path, environment)
    payload = json.dumps(report, ensure_ascii=False)

    assert report["overall"] == "ready"
    assert report["summary"] == {"ready": 7, "blocked": 0, "total": 7}
    assert [item["id"] for item in report["components"]] == [
        "api",
        "web",
        "database",
        "personal_wechat_bridge",
        "wechat_work_customer_service",
        "design_platform",
        "model_chain",
    ]
    for secret in (environment["CUSTOM_API_KEY"], environment["WECHAT_WORK_SECRET"], environment["WECHAT_WORK_TOKEN"], aes_key):
        assert secret not in payload


def test_doctor_lists_real_missing_configuration_for_all_blocked_components(tmp_path):
    _write_project(
        tmp_path,
        """
ai_engine:
  enabled: true
  primary: missing_provider
  fallback_chain: []
  providers: {}
""".lstrip(),
    )
    environment = {
        "API_PORT": "not-a-port",
        "WEB_PORT": "3200",
        "USE_LOCAL_STORE": "false",
        "DESIGN_PLATFORM_ADAPTER": "art_image_local",
    }

    report = build_report(tmp_path, environment)

    assert report["overall"] == "blocked"
    assert report["summary"] == {"ready": 0, "blocked": 7, "total": 7}
    assert "DATABASE_URL" in _component(report, "database")["missing"]
    assert "WECHAT_SEND_ADAPTER=windows_bridge" in _component(report, "personal_wechat_bridge")["missing"]
    assert "WECHAT_WORK_CORP_ID" in _component(report, "wechat_work_customer_service")["missing"]
    assert "DESIGN_PLATFORM_DEVICE_ID" in _component(report, "design_platform")["missing"]
    assert "at least one enabled AI provider with api_key, base_url and model" in _component(report, "model_chain")["missing"]


def test_doctor_only_reports_presence_for_runtime_design_credentials(tmp_path):
    _write_project(
        tmp_path,
        """
ai_engine:
  enabled: false
  providers: {}
""".lstrip(),
    )
    runtime_dir = tmp_path / "desktop" / ".runtime"
    runtime_dir.mkdir()
    runtime_secret = "runtime-access-token-sentinel"
    runtime_cookie = "session=runtime-cookie-sentinel"
    (runtime_dir / "design-platform-config.json").write_text(
        json.dumps(
            {
                "designPlatformAdapter": "art_image_local",
                "designPlatformBaseUrl": "http://127.0.0.1:3000",
                "designPlatformAccessToken": runtime_secret,
                "designPlatformCookie": runtime_cookie,
                "designPlatformDeviceId": "device-id",
            }
        ),
        encoding="utf-8",
    )

    report = build_report(tmp_path, {})
    design = _component(report, "design_platform")
    payload = json.dumps(report, ensure_ascii=False)

    assert design["status"] == "ready"
    assert design["details"]["credentialConfigured"] is True
    assert runtime_secret not in payload
    assert runtime_cookie not in payload
