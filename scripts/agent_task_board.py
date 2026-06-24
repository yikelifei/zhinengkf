from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]
MODULE_CONFIG = ROOT / "config" / "project_modules.yaml"
TASK_DIR = ROOT / "docs" / "agent_tasks"
TASK_INDEX = TASK_DIR / "AGENT_TASK_INDEX.md"
SAFE_MODULE_ID_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


def safe_module_id(value: str) -> str:
    module_id = str(value or "").strip()
    if not module_id or any(char not in SAFE_MODULE_ID_CHARS for char in module_id):
        raise ValueError(f"Unsafe module id: {value}")
    return module_id


def task_path_for(module_id: str) -> Path:
    return TASK_DIR / f"{safe_module_id(module_id)}.md"


def load_modules() -> list[dict[str, Any]]:
    with MODULE_CONFIG.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    modules = data.get("modules")
    if not isinstance(modules, list):
        raise ValueError("config/project_modules.yaml must contain a modules list")
    return modules


def find_module(module_id: str) -> dict[str, Any]:
    for module in load_modules():
        if module.get("id") == module_id:
            return module
    known = ", ".join(str(item.get("id")) for item in load_modules())
    raise SystemExit(f"Unknown module id: {module_id}\nKnown modules: {known}")


def bullets(items: list[str] | None) -> str:
    if not items:
        return "- 暂无"
    return "\n".join(f"- {item}" for item in items)


def commands(items: list[str] | None) -> str:
    if not items:
        return "- 暂无自动命令；先补齐最小可运行脚本和测试。"
    return "\n".join(f"- `{item}`" for item in items)


def prompt_for(module: dict[str, Any]) -> str:
    module_id = module["id"]
    return f"""# 子线程任务：{module.get('title', module_id)}

你是智能客服项目的一个独立子线程，负责推进 `{module_id}`。

## 工作目录

仓库根目录。先确认当前目录包含 `config/`、`core/`、`scripts/`、`tests/`。

## 总约束

- 以瞎猜接口为耻，以认真查询为荣。
- 以模糊执行为耻，以寻求确认为荣。
- 以创造接口为耻，以复用现有为荣。
- 以跳过验证为耻，以主动测试为荣。
- 以盲目修改为耻，以谨慎重构为荣。
- 你不是唯一线程，不要 revert、reset 或覆盖别人改动。
- 修改前先看现有代码风格，优先复用已有脚本、配置、数据结构。
- 不能臆造微信、抖音、小红书、淘宝、拼多多、快手等平台 API；没有官方或已验证接口时，只能做本地抽象、人工录入、导入、审核和对接预留。

## 模块信息

- 模块 ID：`{module_id}`
- 分类：`{module.get('category', '-')}`
- 状态：`{module.get('status', '-')}`
- 文档：`{module.get('doc', '-')}`

## 目标

{module.get('purpose', '')}

## 输入

{bullets(module.get('inputs'))}

## 输出

{bullets(module.get('outputs'))}

## 验收标准

{bullets(module.get('acceptance'))}

## 已配置运行命令

{commands(module.get('run_commands'))}

## 已配置检查命令

{commands(module.get('check_commands'))}

## 当前下一步

{bullets(module.get('next_steps'))}

## 交付要求

1. 先判断这个模块当前是补文档、补测试、补本地功能，还是接入已有控制台。
2. 只做一个清晰、可验证的小步，不要一次性大改架构。
3. 新增或修改文件后，运行和本模块最相关的检查命令。
4. 最终回复必须列出：修改文件、验证命令、剩余风险、下一轮建议。
"""


def generate() -> None:
    TASK_DIR.mkdir(parents=True, exist_ok=True)
    modules = load_modules()
    index = [
        "# 子线程任务索引",
        "",
        "这些文件用于把项目模块直接喂给新的 Codex 子线程，避免每次人工重复描述上下文。",
        "",
        "## 使用方式",
        "",
        "- 生成任务文件：`tools\\agents\\generate_agent_tasks.bat`",
        "- 查看任务列表：`tools\\agents\\list_agent_tasks.bat`",
        "- 打印单个任务：`tools\\agents\\show_agent_task.bat <模块ID>`",
        "",
        "## 任务列表",
        "",
        "| 模块 | 分类 | 状态 | 子线程提示词 |",
        "| --- | --- | --- | --- |",
    ]
    for module in modules:
        module_id = safe_module_id(module["id"])
        task_path = task_path_for(module_id)
        task_path.write_text(prompt_for(module), encoding="utf-8", newline="\n")
        index.append(
            f"| {module.get('title', module_id)} | `{module.get('category', '-')}` "
            f"| `{module.get('status', '-')}` | [{module_id}.md]({module_id}.md) |"
        )
    TASK_INDEX.write_text("\n".join(index) + "\n", encoding="utf-8", newline="\n")
    print(f"Generated {len(modules)} agent task prompts in {TASK_DIR}")


def list_tasks() -> None:
    print("ID                         STATUS    CATEGORY          TITLE")
    print("-" * 78)
    for module in load_modules():
        print(
            f"{module['id']:<26} {module.get('status', '-'):<9} "
            f"{module.get('category', '-'):<17} {module.get('title', '-')}"
        )


def show_task(module_id: str) -> None:
    module = find_module(module_id)
    path = task_path_for(module["id"])
    if not path.exists():
        generate()
    sys.stdout.write(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成和查看 Codex 子线程任务")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("generate")
    subparsers.add_parser("list")
    show_parser = subparsers.add_parser("show")
    show_parser.add_argument("module_id")
    args = parser.parse_args(argv)

    if args.command == "generate":
        generate()
        return 0
    if args.command == "list":
        list_tasks()
        return 0
    if args.command == "show":
        show_task(args.module_id)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
