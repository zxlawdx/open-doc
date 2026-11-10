#ifndef ReleaseVersion
  #error Supply ReleaseVersion through /DReleaseVersion
#endif

[Setup]
AppId=OpenDoc
AppName=Open Doc
AppVersion={#ReleaseVersion}
AppPublisher=Open Doc Contributors
DefaultDirName={localappdata}\Programs\Vela\Open-Doc
DefaultGroupName=Open Doc
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
SetupIconFile=..\..\build\open-doc.ico
UninstallDisplayIcon={app}\Open-Doc.exe
OutputDir=..\..\dist\release
OutputBaseFilename=Open-Doc-{#ReleaseVersion}-Windows-x64-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\..\dist\Open-Doc\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; Flags: unchecked

[Icons]
Name: "{autoprograms}\Open Doc"; Filename: "{app}\Open-Doc.exe"
Name: "{autodesktop}\Open Doc"; Filename: "{app}\Open-Doc.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Open-Doc.exe"; Description: "Abrir Open Doc"; Flags: nowait postinstall skipifsilent
