from scripts import project_modules


def _assert_value_error(command):
    try:
        project_modules.parse_project_command(command)
    except ValueError:
        return
    raise AssertionError(f"accepted unsafe command: {command}")


def test_parse_project_command_accepts_known_project_tools():
    assert project_modules.parse_project_command("tools\\quality\\run_tests.bat") == [
        "tools\\quality\\run_tests.bat"
    ]
    assert project_modules.parse_project_command("node --check docs\\web_console.js") == [
        "node",
        "--check",
        "docs\\web_console.js",
    ]


def test_parse_project_command_rejects_shell_syntax_and_unknown_executables():
    _assert_value_error("tools\\quality\\run_tests.bat & whoami")
    _assert_value_error("powershell -Command Get-ChildItem")
    _assert_value_error("python scripts\\main.py")


def test_parse_project_command_rejects_paths_outside_project_contract():
    _assert_value_error("..\\run.bat")
    _assert_value_error("tools\\quality\\missing.bat")
    _assert_value_error("node --check scripts\\web_console.py")


def test_run_project_command_uses_shell_wrapper_only_for_batch_files():
    calls = []

    class Completed:
        returncode = 0

    def fake_run(cmd, cwd, env):
        calls.append((cmd, cwd, env))
        return Completed()

    env = {"PYTHONPATH": "x"}
    original_run = project_modules.subprocess.run
    try:
        project_modules.subprocess.run = fake_run
        assert project_modules.run_project_command("tools\\quality\\run_tests.bat", env) == 0
        assert calls[-1][0][:3] == [project_modules.os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c"]
        assert calls[-1][0][-1] == "tools\\quality\\run_tests.bat"

        assert project_modules.run_project_command("node --check docs\\web_console.js", env) == 0
        assert calls[-1][0] == ["node", "--check", "docs\\web_console.js"]
    finally:
        project_modules.subprocess.run = original_run
