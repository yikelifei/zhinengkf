Smart Bot Windows 安装包说明

包含：
- `dist/smart_bot_installer.zip` — 自包含安装包（包含 `smart_bot.exe` 及 `_internal` 资源）
- `install.ps1` — PowerShell 安装脚本（将 ZIP 解压到 `C:\Program Files\SmartBot` 并创建开始菜单快捷方式）
- `uninstall.ps1` — 卸载脚本

使用方法（以管理员身份运行 PowerShell）：

```powershell
cd <repository root>\installer
# 以管理员打开 PowerShell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force
.\install.ps1 -ZipPath "..\dist\smart_bot_installer.zip"
```

卸载：

```powershell
cd <repository root>\installer
.\uninstall.ps1
```

可选：使用 Inno Setup 或 NSIS 创建更加完整的安装程序，示例脚本已放在 `installer/` 目录（如果需要我可以生成）。

使用 Inno Setup 编译安装程序：

1. 安装 Inno Setup（https://jrsoftware.org/），确保 `ISCC.exe` 在 PATH 中或安装路径为 `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`。
2. 在项目根目录打开命令行，切换到 `installer`：

```powershell
cd <repository root>\installer
```

3. 运行批处理脚本构建安装程序：

```powershell
.\build_inno.bat
```

编译成功后，安装程序 EXE 将写到 `dist` 目录中（示例为 `dist\Output\setup.exe`，具体名称由 Inno 输出决定）。
