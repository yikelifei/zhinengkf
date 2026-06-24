; Inno Setup script example for Smart Bot
[Setup]
AppName=Smart Bot
AppVersion=1.0
DefaultDirName={pf}\SmartBot
DefaultGroupName=Smart Bot
DisableStartupPrompt=yes
Compression=lzma2
SolidCompression=yes

[Files]
Source: "..\dist\smart_bot\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Smart Bot"; Filename: "{app}\smart_bot.exe"
Name: "{userdesktop}\Smart Bot"; Filename: "{app}\smart_bot.exe"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked
