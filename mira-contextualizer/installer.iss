; Inno Setup script — FactoryLM Contextualizer installer.
; Build the app first (pyinstaller MIRA-Contextualizer.spec), then compile this with Inno Setup:
;     ISCC.exe installer.iss   ->   Output\FactoryLM-Contextualizer-Setup.exe
; Produces a real Windows program: Start-menu + desktop shortcuts, file associations, uninstaller.

#define AppName "FactoryLM Contextualizer"
#define AppVer "2.0.0"
#define AppExe "FactoryLM-Contextualizer.exe"

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
DefaultDirName={autopf}\FactoryLM Contextualizer
DefaultGroupName=FactoryLM Contextualizer
UninstallDisplayIcon={app}\{#AppExe}
OutputBaseFilename=FactoryLM-Contextualizer-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Files]
; Lay down the entire PyInstaller onedir tree.
Source: "dist\FactoryLM-Contextualizer\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\FactoryLM Contextualizer"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall FactoryLM Contextualizer"; Filename: "{uninstallexe}"
Name: "{autodesktop}\FactoryLM Contextualizer"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Registry]
; Light-touch "Open with" association for the formats the app ingests (per-user).
Root: HKCU; Subkey: "Software\Classes\.l5x\OpenWithProgids"; ValueType: string; ValueName: "FactoryLM.Contextualizer"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\FactoryLM.Contextualizer"; ValueType: string; ValueName: ""; ValueData: "PLC / factory document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\FactoryLM.Contextualizer\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch FactoryLM Contextualizer"; Flags: nowait postinstall skipifsilent
