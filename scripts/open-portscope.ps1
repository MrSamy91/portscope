<#
  Ouvre Portscope dans sa propre fenêtre, en le démarrant seulement si besoin.

  - Déjà ouvert : remet la fenêtre Portscope au premier plan, rien d'autre.
  - Serveur lancé mais fenêtre fermée : rouvre juste la fenêtre.
  - Rien ne tourne : (re)construit si le code a changé, démarre le serveur sur le port
    fixe 4310, ouvre la fenêtre, puis arrête le serveur quand la fenêtre est fermée.
    Rien ne reste en arrière-plan.

  Port 4310 : hors de la plage 3001-3999 attribuée aux sandboxes de dev.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$port = 4310
$url = "http://127.0.0.1:$port"
# Profil de navigateur dédié : permet de retrouver la fenêtre Portscope parmi les autres.
$profileDir = Join-Path $env:LOCALAPPDATA "Portscope\browser"
$edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
Set-Location $root

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PortscopeWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
"@

function Show-Message([string]$text) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($text, "Portscope") | Out-Null
}

# Processus du navigateur qui utilisent le profil Portscope.
function Get-PortscopeBrowser {
  $needle = $profileDir.ToLower()
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($needle) }
}

# Handle de la fenêtre Portscope visible, ou $null.
function Get-PortscopeWindow {
  foreach ($proc in Get-PortscopeBrowser) {
    $p = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { return $p.MainWindowHandle }
  }
  return $null
}

function Test-Server {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.Content -match "<title>Portscope"
  } catch {
    return $false
  }
}

function Open-Window {
  Start-Process $edge -ArgumentList @(
    "--user-data-dir=`"$profileDir`"",
    "--app=$url",
    "--no-first-run",
    "--window-size=1440,920"
  )
}

# 1. Déjà ouvert : on remet simplement la fenêtre devant.
$window = Get-PortscopeWindow
if ($window) {
  if ([PortscopeWin]::IsIconic($window)) { [PortscopeWin]::ShowWindow($window, 9) | Out-Null }
  [PortscopeWin]::SetForegroundWindow($window) | Out-Null
  exit 0
}

# 2. Serveur déjà lancé (par exemple `pnpm dev`) : on ouvre juste la fenêtre.
if (Test-Server) {
  Open-Window
  exit 0
}

# 3. Port pris par autre chose : on ne tue rien, on prévient.
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $owner = Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue
  Show-Message "Le port $port est déjà utilisé par $($owner.ProcessName) (PID $($busy[0].OwningProcess)). Libère-le puis relance Portscope."
  exit 1
}

# 4. Rebuild seulement si le code a changé depuis le dernier build.
#    La console (cachée par le raccourci) s'affiche le temps du build pour montrer la progression.
$buildId = Join-Path $root ".next\BUILD_ID"
$newest = Get-ChildItem -Path app, components, lib, package.json -Recurse -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $buildId) -or $newest.LastWriteTime -gt (Get-Item $buildId).LastWriteTime) {
  $console = [PortscopeWin]::GetConsoleWindow()
  [PortscopeWin]::ShowWindow($console, 5) | Out-Null
  $Host.UI.RawUI.WindowTitle = "Portscope - construction"
  Write-Host "Code modifié depuis le dernier build : construction (une minute environ)..."
  pnpm build
  if ($LASTEXITCODE -ne 0) {
    Read-Host "Le build a échoué. Entrée pour fermer"
    exit 1
  }
  [PortscopeWin]::ShowWindow($console, 0) | Out-Null
}

# 5. Démarre le serveur ; ce script reste son parent tant que la fenêtre est ouverte.
$server = Start-Process pnpm -ArgumentList "start" -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
  $ready = $false
  for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
    Start-Sleep -Milliseconds 500
    $ready = Test-Server
  }
  if (-not $ready) {
    Show-Message "Portscope n'a pas démarré. Lance « pnpm start » dans $root pour voir l'erreur."
    exit 1
  }

  Open-Window

  # Attend l'apparition de la fenêtre, puis sa fermeture.
  for ($i = 0; $i -lt 40 -and -not (Get-PortscopeWindow); $i++) { Start-Sleep -Milliseconds 500 }
  $missing = 0
  while ($missing -lt 2) {
    Start-Sleep -Seconds 2
    if (Get-PortscopeWindow) { $missing = 0 } else { $missing++ }
  }
} finally {
  # Arbre du serveur lancé ici + navigateur resté en arrière-plan sur le profil Portscope.
  taskkill /PID $server.Id /T /F 2>$null | Out-Null
  Get-PortscopeBrowser | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
