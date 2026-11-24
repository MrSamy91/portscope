<#
  Crée le raccourci « Portscope » dans le menu Démarrer de l'utilisateur.
  Le raccourci lance open-portscope.ps1 sans fenêtre de console, avec l'icône du projet.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$link = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Portscope.lnk"

$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\open-portscope.ps1`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$PSScriptRoot\portscope.ico,0"
$shortcut.WindowStyle = 7
$shortcut.Description = "Ports et processus de cette machine"
$shortcut.Save()
Write-Host "Raccourci créé : $link"
