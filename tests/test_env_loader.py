import os

from core.env_loader import _load_env_fallback


def test_env_loader_fallback_reads_values(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "API_KEY=sk-test\n"
        "QUOTED=\"hello world\"\n"
        "# ignored\n"
        "EMPTY=\n",
        encoding="utf-8",
    )

    monkeypatch.delenv("API_KEY", raising=False)
    monkeypatch.delenv("QUOTED", raising=False)
    monkeypatch.setenv("EMPTY", "already-set")

    _load_env_fallback(str(env_path))

    assert os.environ["API_KEY"] == "sk-test"
    assert os.environ["QUOTED"] == "hello world"
    assert os.environ["EMPTY"] == "already-set"
