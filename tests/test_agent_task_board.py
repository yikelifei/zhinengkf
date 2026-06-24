import io
import sys

import yaml

from scripts import agent_task_board


def _install_task_fixture(tmp_path, modules):
    original = (
        agent_task_board.MODULE_CONFIG,
        agent_task_board.TASK_DIR,
        agent_task_board.TASK_INDEX,
    )
    config_path = tmp_path / "project_modules.yaml"
    task_dir = tmp_path / "agent_tasks"
    agent_task_board.MODULE_CONFIG = config_path
    agent_task_board.TASK_DIR = task_dir
    agent_task_board.TASK_INDEX = task_dir / "AGENT_TASK_INDEX.md"
    config_path.write_text(yaml.safe_dump({"modules": modules}, allow_unicode=True), encoding="utf-8")
    return original


def _restore_task_fixture(original):
    (
        agent_task_board.MODULE_CONFIG,
        agent_task_board.TASK_DIR,
        agent_task_board.TASK_INDEX,
    ) = original


def _minimal_module(module_id="01_wechat_core"):
    return {
        "id": module_id,
        "title": "微信主客服闭环",
        "category": "channel",
        "status": "running",
        "purpose": "稳定收消息、生成回复、发送回复、记录会话。",
        "inputs": ["微信 PC 客户端消息"],
        "outputs": ["客户会话和线索记录"],
        "acceptance": ["常见问题能自动回复。"],
    }


def test_task_path_for_accepts_only_safe_module_ids():
    assert agent_task_board.task_path_for("abc_123-test").name == "abc_123-test.md"
    for module_id in ("../escape", "..\\escape", "bad/id", "bad:id", "", "a b"):
        try:
            agent_task_board.task_path_for(module_id)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe module id accepted: {module_id}")


def test_show_task_generates_and_prints_known_module(tmp_path):
    original = _install_task_fixture(tmp_path, [_minimal_module()])
    output = io.StringIO()
    original_stdout = sys.stdout
    try:
        sys.stdout = output
        agent_task_board.show_task("01_wechat_core")
    finally:
        sys.stdout = original_stdout
        _restore_task_fixture(original)

    text = output.getvalue()
    assert "子线程任务：微信主客服闭环" in text
    assert "01_wechat_core" in text


def test_generate_rejects_unsafe_configured_module_id(tmp_path):
    original = _install_task_fixture(tmp_path, [_minimal_module("../escape")])
    try:
        try:
            agent_task_board.generate()
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe configured module id should be rejected")
        assert not (tmp_path / "escape.md").exists()
    finally:
        _restore_task_fixture(original)
