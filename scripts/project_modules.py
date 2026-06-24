from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "project_modules.yaml"
INDEX_PATH = ROOT / "docs" / "PROJECT_MODULES_INDEX.md"
SHELL_META_CHARS = set("&|;<>()\r\n")


def _project_relative_path(raw: str) -> Path:
    path = Path(raw)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Command path must stay inside the project: {raw}")
    return path


def parse_project_command(command: str) -> list[str]:
    if not isinstance(command, str) or not command.strip():
        raise ValueError("Command must be a non-empty string")
    if any(char in command for char in SHELL_META_CHARS):
        raise ValueError(f"Unsupported shell syntax in command: {command}")

    parts = shlex.split(command, posix=False)
    if not parts:
        raise ValueError("Command must contain an executable")

    executable = parts[0]
    executable_lower = executable.lower()
    if executable_lower == "node":
        if len(parts) != 3 or parts[1] != "--check":
            raise ValueError(f"Unsupported node command: {command}")
        script = _project_relative_path(parts[2])
        if script.suffix.lower() != ".js" or script.parts[0] != "docs":
            raise ValueError(f"Node check must target a docs JavaScript file: {command}")
        if not (ROOT / script).exists():
            raise ValueError(f"Command target does not exist: {script}")
        return parts

    batch_path = _project_relative_path(executable)
    if batch_path.suffix.lower() != ".bat" or batch_path.parts[0] != "tools":
        raise ValueError(f"Unsupported project command: {command}")
    if not (ROOT / batch_path).exists():
        raise ValueError(f"Command target does not exist: {batch_path}")
    for arg in parts[1:]:
        _project_relative_path(arg)
    return parts


def run_project_command(command: str, env: dict[str, str]) -> int:
    parts = parse_project_command(command)
    if parts[0].lower().endswith(".bat"):
        cmd = [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", *parts]
    else:
        cmd = parts
    return subprocess.run(cmd, cwd=ROOT, env=env).returncode


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Missing module config: {CONFIG_PATH}")
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data.get("modules"), list):
        raise ValueError("config/project_modules.yaml must contain a modules list")
    return data


def modules_by_id(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for module in data["modules"]:
        module_id = module.get("id")
        if not module_id:
            raise ValueError("Every module must have an id")
        if module_id in result:
            raise ValueError(f"Duplicate module id: {module_id}")
        result[module_id] = module
    return result


def bullet_lines(items: list[str] | None) -> list[str]:
    return [f"- {item}" for item in (items or [])]


def command_lines(commands: list[str] | None) -> list[str]:
    if not commands:
        return ["- 暂无可自动执行命令。"]
    return [f"- `{command}`" for command in commands]


def print_list(data: dict[str, Any]) -> None:
    print("ID                         STATUS    CATEGORY          TITLE")
    print("-" * 78)
    for module in data["modules"]:
        print(
            f"{module['id']:<26} {module.get('status', '-'):<9} "
            f"{module.get('category', '-'):<17} {module.get('title', '-')}"
        )


def print_module(module: dict[str, Any]) -> None:
    print(f"# {module['id']} - {module.get('title', '')}")
    print(f"分类: {module.get('category', '-')}")
    print(f"状态: {module.get('status', '-')}")
    print(f"文档: {module.get('doc', '-')}")
    print()
    print(module.get("purpose", ""))
    print()
    print("输入:")
    print("\n".join(bullet_lines(module.get("inputs"))) or "- 无")
    print()
    print("输出:")
    print("\n".join(bullet_lines(module.get("outputs"))) or "- 无")
    print()
    print("运行命令:")
    print("\n".join(command_lines(module.get("run_commands"))))
    print()
    print("检查命令:")
    print("\n".join(command_lines(module.get("check_commands"))))
    print()
    print("验收标准:")
    print("\n".join(bullet_lines(module.get("acceptance"))) or "- 无")
    print()
    print("下一步:")
    print("\n".join(bullet_lines(module.get("next_steps"))) or "- 无")


def run_commands(module: dict[str, Any], key: str) -> int:
    commands = module.get(key) or []
    if not commands:
        print(f"{module['id']} 没有配置 {key}，只输出模块说明。")
        print_module(module)
        return 0

    env = os.environ.copy()
    env.setdefault("SMART_KEFU_NO_PAUSE", "1")
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env["PYTHONPATH"] = f"{ROOT / '.codex_deps'}{os.pathsep}{ROOT}"

    for command in commands:
        print(f"\n>>> {command}")
        try:
            returncode = run_project_command(command, env)
        except ValueError as exc:
            print(f"Invalid project command: {exc}")
            return 2
        if returncode != 0:
            print(f"命令失败: {command}")
            return returncode
    return 0


def module_doc(module: dict[str, Any]) -> str:
    lines = [
        f"# {module.get('title', module['id'])}",
        "",
        f"- 模块 ID: `{module['id']}`",
        f"- 分类: `{module.get('category', '-')}`",
        f"- 状态: `{module.get('status', '-')}`",
        "",
        "## 目标",
        "",
        module.get("purpose", ""),
        "",
        "## 输入",
        "",
        *bullet_lines(module.get("inputs")),
        "",
        "## 输出",
        "",
        *bullet_lines(module.get("outputs")),
        "",
        "## 独立运行",
        "",
        *command_lines(module.get("run_commands")),
        "",
        "## 独立检查",
        "",
        *command_lines(module.get("check_commands")),
        "",
        "## 验收标准",
        "",
        *bullet_lines(module.get("acceptance")),
        "",
        "## 下一步",
        "",
        *bullet_lines(module.get("next_steps")),
        "",
    ]
    return "\n".join(lines)


def generate_docs(data: dict[str, Any]) -> None:
    project_dir = ROOT / "docs" / "projects"
    project_dir.mkdir(parents=True, exist_ok=True)

    index_lines = [
        "# 智能客服项目模块索引",
        "",
        f"配置来源: `config/project_modules.yaml`",
        f"更新时间: `{data.get('updated_at', '-')}`",
        "",
        "## 使用方式",
        "",
        "- 查看全部模块: `tools\\projects\\list_projects.bat`",
        "- 查看单个模块: `tools\\_run_python_task.bat scripts\\project_modules.py show <模块ID>`",
        "- 独立运行模块: `tools\\projects\\run_project.bat <模块ID>`",
        "- 独立检查模块: `tools\\projects\\check_project.bat <模块ID>`",
        "- 运行全部可运行模块: `tools\\projects\\run_all_projects.bat`",
        "- 检查全部模块: `tools\\projects\\check_all_projects.bat`",
        "",
        "## 模块列表",
        "",
        "| 模块 | 分类 | 状态 | 说明 |",
        "| --- | --- | --- | --- |",
    ]

    for module in data["modules"]:
        doc_rel = module.get("doc", f"docs/projects/{module['id']}.md")
        doc_path = ROOT / doc_rel
        doc_path.parent.mkdir(parents=True, exist_ok=True)
        doc_path.write_text(module_doc(module), encoding="utf-8", newline="\n")
        doc_link = Path(doc_rel).relative_to("docs").as_posix()
        index_lines.append(
            f"| [{module.get('title', module['id'])}]({doc_link}) "
            f"| `{module.get('category', '-')}` | `{module.get('status', '-')}` "
            f"| {module.get('purpose', '')} |"
        )

    index_lines.extend(
        [
            "",
            "## 分类说明",
            "",
            "- `channel`: 微信和后续平台消息通道。",
            "- `lead_acquisition`: 抖音、小红书等平台线索承接。",
            "- `knowledge`: 知识库、话术学习和人工审核。",
            "- `reply`: 智能回复、人情味表达和安全护栏。",
            "- `crm`: 高价值客户筛选和优先跟进。",
            "- `sales_ops`: 报价、跟进、订单交接。",
            "- `image_delivery`: 出图提示词和图片交付任务。",
            "- `integration`: 本地 API 和外部软件集成。",
            "- `console`: 统一工作台。",
            "- `quality`: 自动测试、验收、备份和上线检查。",
            "",
        ]
    )
    INDEX_PATH.write_text("\n".join(index_lines), encoding="utf-8", newline="\n")
    print(f"Generated {INDEX_PATH}")
    print(f"Generated {len(data['modules'])} project docs in {project_dir}")


def resolve_module(data: dict[str, Any], module_id: str) -> dict[str, Any]:
    modules = modules_by_id(data)
    try:
        return modules[module_id]
    except KeyError as exc:
        known = ", ".join(modules)
        raise SystemExit(f"Unknown module id: {module_id}\nKnown modules: {known}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="智能客服项目模块运行器")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="列出全部项目模块")
    subparsers.add_parser("generate-docs", help="根据模块清单生成 Markdown 文档")

    show_parser = subparsers.add_parser("show", help="查看单个项目模块")
    show_parser.add_argument("module_id")

    run_parser = subparsers.add_parser("run", help="独立运行单个项目模块")
    run_parser.add_argument("module_id")

    check_parser = subparsers.add_parser("check", help="独立检查单个项目模块")
    check_parser.add_argument("module_id")

    subparsers.add_parser("run-all", help="按清单运行所有有 run_commands 的模块")
    subparsers.add_parser("check-all", help="按清单检查所有有 check_commands 的模块")

    args = parser.parse_args(argv)
    data = load_config()

    if args.command == "list":
        print_list(data)
        return 0
    if args.command == "generate-docs":
        generate_docs(data)
        return 0
    if args.command == "show":
        print_module(resolve_module(data, args.module_id))
        return 0
    if args.command == "run":
        return run_commands(resolve_module(data, args.module_id), "run_commands")
    if args.command == "check":
        return run_commands(resolve_module(data, args.module_id), "check_commands")
    if args.command == "run-all":
        for module in data["modules"]:
            if module.get("run_commands"):
                rc = run_commands(module, "run_commands")
                if rc != 0:
                    return rc
        return 0
    if args.command == "check-all":
        for module in data["modules"]:
            if module.get("check_commands"):
                rc = run_commands(module, "check_commands")
                if rc != 0:
                    return rc
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
