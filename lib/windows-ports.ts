import "server-only";

import { execFile } from "node:child_process";
import { availableParallelism, totalmem } from "node:os";
import { promisify } from "node:util";

import {
  detectProject,
  readRegisteredProcesses,
  sameStart,
} from "@/lib/sandbox-registry";
import type { PortEntry, PortsResponse } from "@/lib/types";

const execFileAsync = promisify(execFile);

const PROTECTED_PROCESS_NAMES = new Set([
  "system",
  "registry",
  "smss",
  "csrss",
  "wininit",
  "services",
  "lsass",
  "winlogon",
  "fontdrvhost",
  "svchost",
  "spoolsv",
  "dashost",
  "sihost",
  "taskhostw",
  "dwm",
  "audiodg",
  "wudfhost",
  "searchindexer",
]);

const WINDOWS_PORTS_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()',
  '$tcpConnections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue)',
  '$tcpListeners = @($tcpConnections | Where-Object { $_.State -eq "Listen" })',
  '$udpListeners = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue)',
  '$establishedCounts = @{}',
  'foreach ($connection in $tcpConnections) {',
  '  if ($connection.State -eq "Established") {',
  '    $key = "$($connection.OwningProcess):$($connection.LocalPort)"',
  '    if ($establishedCounts.ContainsKey($key)) { $establishedCounts[$key] += 1 } else { $establishedCounts[$key] = 1 }',
  '  }',
  '}',
  '$cimByPid = @{}',
  'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object { $cimByPid[[int]$_.ProcessId] = $_ }',
  // Index parent → enfants, pour mesurer l'arbre complet (ce que « Arrêter » tue réellement).
  '$childrenByPid = @{}',
  'foreach ($p in $cimByPid.Values) { $pp = [int]$p.ParentProcessId; if ($pp -eq [int]$p.ProcessId) { continue }; if (-not $childrenByPid.ContainsKey($pp)) { $childrenByPid[$pp] = New-Object System.Collections.ArrayList }; [void]$childrenByPid[$pp].Add($p) }',
  '$processByPid = @{}',
  '$allPids = @(@($tcpListeners | ForEach-Object { [int]$_.OwningProcess }); @($udpListeners | ForEach-Object { [int]$_.OwningProcess })) | Sort-Object -Unique',
  'foreach ($ownerPid in $allPids) {',
  '  $process = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue',
  '  $cim = $cimByPid[$ownerPid]',
  '  $startedAt = $null',
  '  if ($process) { try { $startedAt = $process.StartTime.ToUniversalTime().ToString("o") } catch {} }',
  // Windows n'expose pas le dossier courant d'un processus : on remonte ses parents pour
  // retrouver une ligne de commande qui contient le chemin du projet (pnpm dev → node → next-server).
  '  $chain = @(); $cur = $cim; $depth = 0',
  '  while ($cur -and $depth -lt 6) {',
  '    if ($cur.CommandLine) { $chain += [string]$cur.CommandLine } elseif ($cur.ExecutablePath) { $chain += [string]$cur.ExecutablePath }',
  '    $parentPid = [int]$cur.ParentProcessId',
  '    if ($parentPid -le 4 -or $parentPid -eq [int]$cur.ProcessId) { break }',
  '    $next = $cimByPid[$parentPid]',
  // Un parent né après l'enfant est un PID recyclé : ce n'est pas le vrai parent.
  '    if (-not $next -or ($next.CreationDate -and $cur.CreationDate -and $next.CreationDate -gt $cur.CreationDate)) { break }',
  '    $cur = $next; $depth++',
  '  }',
  // Mémoire et temps CPU cumulés du processus et de ses descendants (enfant né avant son parent = PID recyclé, ignoré).
  '  $treeMem = [long]0; $treeCpu = [long]0; $treeCount = 0',
  '  if ($cim) {',
  '    $stack = New-Object System.Collections.Stack; $stack.Push($cim); $seen = @{}',
  '    while ($stack.Count -gt 0 -and $treeCount -lt 200) {',
  '      $node = $stack.Pop(); $nodePid = [int]$node.ProcessId',
  '      if ($seen.ContainsKey($nodePid)) { continue }',
  '      $seen[$nodePid] = $true',
  '      $treeMem += [long]$node.WorkingSetSize; $treeCpu += [long]$node.KernelModeTime + [long]$node.UserModeTime; $treeCount++',
  '      if ($childrenByPid.ContainsKey($nodePid)) { foreach ($child in $childrenByPid[$nodePid]) { if (-not ($child.CreationDate -and $node.CreationDate -and $child.CreationDate -lt $node.CreationDate)) { $stack.Push($child) } } }',
  '    }',
  '  }',
  '  $processByPid[$ownerPid] = [PSCustomObject]@{',
  '    name = if ($process) { $process.ProcessName } elseif ($cim) { $cim.Name } else { "PID $ownerPid" }',
  '    path = if ($cim -and $cim.ExecutablePath) { $cim.ExecutablePath } elseif ($process) { $process.Path } else { $null }',
  '    commandLine = if ($cim) { $cim.CommandLine } else { $null }',
  '    startedAt = $startedAt',
  '    memoryBytes = if ($cim) { $treeMem } elseif ($process) { [long]$process.WorkingSet64 } else { $null }',
  '    cpuTime = if ($cim) { $treeCpu } else { $null }',
  '    processCount = [Math]::Max(1, $treeCount)',
  '    selfMemoryBytes = if ($cim) { [long]$cim.WorkingSetSize } elseif ($process) { [long]$process.WorkingSet64 } else { $null }',
  '    selfCpuTime = if ($cim) { [long]$cim.KernelModeTime + [long]$cim.UserModeTime } else { $null }',
  '    chain = @($chain)',
  '  }',
  '}',
  '$rows = @()',
  'foreach ($listener in $tcpListeners) {',
  '  $ownerPid = [int]$listener.OwningProcess',
  '  $processInfo = $processByPid[$ownerPid]',
  '  $connectionKey = "$($ownerPid):$($listener.LocalPort)"',
  '  $rows += [PSCustomObject]@{',
  '    protocol = "TCP"; address = [string]$listener.LocalAddress; port = [int]$listener.LocalPort; pid = $ownerPid',
  '    processName = $processInfo.name; processPath = $processInfo.path; commandLine = $processInfo.commandLine',
  '    startedAt = $processInfo.startedAt; memoryBytes = $processInfo.memoryBytes; chain = $processInfo.chain',
  '    cpuTime = $processInfo.cpuTime; processCount = $processInfo.processCount; selfMemoryBytes = $processInfo.selfMemoryBytes; selfCpuTime = $processInfo.selfCpuTime',
  '    activeConnections = if ($establishedCounts.ContainsKey($connectionKey)) { [int]$establishedCounts[$connectionKey] } else { 0 }',
  '  }',
  '}',
  'foreach ($listener in $udpListeners) {',
  '  $ownerPid = [int]$listener.OwningProcess',
  '  $processInfo = $processByPid[$ownerPid]',
  '  $rows += [PSCustomObject]@{',
  '    protocol = "UDP"; address = [string]$listener.LocalAddress; port = [int]$listener.LocalPort; pid = $ownerPid',
  '    processName = $processInfo.name; processPath = $processInfo.path; commandLine = $processInfo.commandLine',
  '    startedAt = $processInfo.startedAt; memoryBytes = $processInfo.memoryBytes; chain = $processInfo.chain; activeConnections = 0',
  '    cpuTime = $processInfo.cpuTime; processCount = $processInfo.processCount; selfMemoryBytes = $processInfo.selfMemoryBytes; selfCpuTime = $processInfo.selfCpuTime',
  '  }',
  '}',
  '[PSCustomObject]@{ items = @($rows) } | ConvertTo-Json -Depth 4 -Compress',
].join("\n");

interface RawPort {
  protocol: "TCP" | "UDP";
  address: string;
  port: number;
  pid: number;
  processName: string;
  processPath: string | null;
  commandLine: string | null;
  startedAt: string | null;
  memoryBytes: number | null;
  activeConnections: number;
  chain: string[] | null;
  /** Temps CPU cumulé de l'arbre, en unités de 100 ns (Win32_Process). */
  cpuTime: number | null;
  processCount: number | null;
  selfMemoryBytes: number | null;
  selfCpuTime: number | null;
}

/**
 * Pour un processus utilisateur, on mesure l'arbre (c'est ce que « Arrêter » tue).
 * Pour un processus système, l'arbre engloberait tout Windows (services → svchost…) :
 * on garde le processus seul.
 */
function withConsumptionScope(item: RawPort): RawPort {
  // Portscope lui-même est « protégé » (on ne se tue pas) mais reste un arbre utilisateur normal.
  const isSelf = item.pid === process.pid || item.pid === process.ppid;
  if (isSelf || !isProtectedProcess(item.pid, item.processName, item.processPath)) return item;
  return { ...item, memoryBytes: item.selfMemoryBytes, cpuTime: item.selfCpuTime, processCount: 1 };
}

/**
 * Windows ne donne qu'un temps CPU cumulé : le % s'obtient en comparant deux relevés.
 * La clé inclut l'heure de démarrage pour ne jamais comparer deux processus différents
 * qui auraient partagé le même PID.
 */
const cpuSamples = new Map<string, { cpuTime: number; at: number }>();

function measureCpuPercent(items: RawPort[]) {
  const now = Date.now();
  const cores = availableParallelism();
  const percentByPid = new Map<number, number | null>();
  const seen = new Set<string>();

  for (const item of items) {
    if (percentByPid.has(item.pid)) continue;
    const key = item.pid + ":" + (item.startedAt ?? "");
    seen.add(key);
    if (item.cpuTime === null) {
      percentByPid.set(item.pid, null);
      continue;
    }
    const previous = cpuSamples.get(key);
    const elapsedMs = previous ? now - previous.at : 0;
    // 100 ns → ms : /10 000. Un enfant terminé entre deux relevés peut faire baisser le cumul : on borne à 0.
    const percent =
      previous && elapsedMs > 250
        ? Math.min(100, Math.max(0, ((item.cpuTime - previous.cpuTime) / 10_000 / elapsedMs / cores) * 100))
        : null;
    percentByPid.set(item.pid, percent);
    cpuSamples.set(key, { cpuTime: item.cpuTime, at: now });
  }

  for (const key of cpuSamples.keys()) {
    if (!seen.has(key)) cpuSamples.delete(key);
  }
  return percentByPid;
}

export async function execPowerShell(script: string) {
  if (process.platform !== "win32") {
    throw new Error("Cette version de Portscope prend actuellement en charge Windows.");
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );

  return stdout.trim();
}

function isLoopbackAddress(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function redactCommandLine(commandLine: string | null) {
  if (!commandLine) return null;

  return commandLine
    .replace(
      /((?:token|secret|password|passwd|api[_-]?key)\s*(?:=|\s)\s*)(?:"[^"]*"|'[^']*'|\S+)/giu,
      "$1••••",
    )
    .replace(/(https?:\/\/[^:\s/]+:)[^@\s]+@/giu, "$1••••@");
}

export function isProtectedProcess(
  pid: number,
  processName: string,
  processPath: string | null = null,
) {
  const normalizedPath = processPath?.replaceAll("/", "\\").toLowerCase();
  const windowsDirectory = (process.env.WINDIR ?? "C:\\Windows")
    .replaceAll("/", "\\")
    .toLowerCase()
    .replace(/\\?$/u, "\\");

  return (
    pid <= 4 ||
    pid === process.pid ||
    pid === process.ppid ||
    normalizedPath?.startsWith(windowsDirectory) === true ||
    PROTECTED_PROCESS_NAMES.has(processName.toLowerCase())
  );
}

export async function listWindowsPorts(): Promise<PortsResponse> {
  const [output, registry] = await Promise.all([
    execPowerShell(WINDOWS_PORTS_SCRIPT),
    readRegisteredProcesses(),
  ]);
  const parsed = output ? (JSON.parse(output) as { items: RawPort[] }) : { items: [] };
  const items = (parsed.items ?? []).map(withConsumptionScope);
  const grouped = new Map<string, PortEntry>();
  const cpuByPid = measureCpuPercent(items);

  for (const item of items) {
    const id = item.protocol + ":" + item.port + ":" + item.pid;
    const existing = grouped.get(id);

    if (existing) {
      if (!existing.addresses.includes(item.address)) {
        existing.addresses.push(item.address);
      }
      existing.activeConnections = Math.max(
        existing.activeConnections,
        item.activeConnections,
      );
      continue;
    }

    // Le registre fait foi (PID + heure de démarrage) ; sinon on déduit le projet du chemin.
    const tracked = registry.processes.find(
      (proc) => proc.pid === item.pid && sameStart(item.startedAt, proc.startedAt),
    );
    const detected = detectProject(item.chain);

    grouped.set(id, {
      id,
      project: tracked?.repo ?? detected?.project ?? null,
      sandbox: tracked?.sandbox ?? detected?.sandbox ?? null,
      trackedAs: tracked?.name ?? null,
      protocol: item.protocol,
      port: item.port,
      addresses: [item.address],
      pid: item.pid,
      processName: item.processName,
      processPath: item.processPath,
      commandLine: redactCommandLine(item.commandLine),
      startedAt: item.startedAt,
      memoryBytes: item.memoryBytes,
      cpuPercent: cpuByPid.get(item.pid) ?? null,
      processCount: item.processCount ?? 1,
      activeConnections: item.activeConnections,
      scope: isLoopbackAddress(item.address) ? "local" : "network",
      protected: isProtectedProcess(
        item.pid,
        item.processName,
        item.processPath,
      ),
    });
  }

  const entries = Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      addresses: entry.addresses.sort(),
      scope: entry.addresses.every(isLoopbackAddress)
        ? ("local" as const)
        : ("network" as const),
    }))
    .sort((left, right) => left.port - right.port || left.pid - right.pid);

  return {
    platform: "Windows",
    scannedAt: new Date().toISOString(),
    machine: { cpuCount: availableParallelism(), totalMemoryBytes: totalmem() },
    entries,
    summary: {
      total: entries.length,
      applications: new Set(entries.map((entry) => entry.pid)).size,
      exposed: entries.filter((entry) => entry.scope === "network").length,
      activeConnections: entries.reduce(
        (total, entry) => total + entry.activeConnections,
        0,
      ),
    },
  };
}

export async function getWindowsProcessIdentity(pid: number) {
  const output = await execPowerShell(
    "$process = Get-Process -Id " +
      pid +
      " -ErrorAction Stop; $cim = Get-CimInstance Win32_Process -Filter 'ProcessId = " +
      pid +
      "' -ErrorAction SilentlyContinue; $path = if ($cim -and $cim.ExecutablePath) { $cim.ExecutablePath } else { $process.Path }; $s = $null; try { $s = $process.StartTime.ToUniversalTime().ToString('o') } catch {}; [PSCustomObject]@{ name = $process.ProcessName; path = $path; startedAt = $s } | ConvertTo-Json -Compress",
  );

  return JSON.parse(output) as { name: string; path: string | null; startedAt: string | null };
}

/**
 * Arrête le processus ET ses descendants : sous Windows, tuer seulement l'écouteur
 * laisse ses enfants (workers, watchers) orphelins, que le sweep devrait ensuite rattraper.
 */
export async function stopWindowsProcess(pid: number) {
  if (process.platform !== "win32") {
    throw new Error("Cette version de Portscope prend actuellement en charge Windows.");
  }
  await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
  });
}
