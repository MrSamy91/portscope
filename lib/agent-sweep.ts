import "server-only";

import {
  readRegisteredProcesses,
  readStateJson,
  readStateText,
  sameStart,
} from "@/lib/sandbox-registry";
import type { SweepAction, SweepResponse, TrackedProcess } from "@/lib/types";
import { execPowerShell } from "@/lib/windows-ports";

const RECENT_DAYS = 7;
const RECENT_LIMIT = 40;

async function readRecentActions(): Promise<SweepAction[]> {
  const text = await readStateText("sweep.log");
  if (!text) return [];
  const since = Date.now() - RECENT_DAYS * 24 * 3600 * 1000;
  const actions: SweepAction[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const action = JSON.parse(line) as SweepAction;
      if (new Date(action.at).getTime() >= since) actions.push(action);
    } catch {
      // Ligne tronquée (rotation ou écriture en cours) : ignorée.
    }
  }
  return actions.reverse().slice(0, RECENT_LIMIT);
}

/** Heure de démarrage réelle (ISO UTC) des PID encore vivants ; null si illisible. */
async function liveStartTimes(pids: number[]) {
  const result = new Map<number, string | null>();
  if (!pids.length) return result;
  const output = await execPowerShell(
    "@(Get-Process -Id " +
      pids.join(",") +
      " -ErrorAction SilentlyContinue | ForEach-Object { $s = $null; try { $s = $_.StartTime.ToUniversalTime().ToString('o') } catch {}; [PSCustomObject]@{ pid = $_.Id; startedAt = $s } }) | ConvertTo-Json -Compress",
  );
  if (!output) return result;
  const parsed = JSON.parse(output) as
    | { pid: number; startedAt: string | null }
    | Array<{ pid: number; startedAt: string | null }>;
  for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
    result.set(item.pid, item.startedAt);
  }
  return result;
}

export async function readAgentSweep(): Promise<SweepResponse> {
  const [lastSweep, recent, registry] = await Promise.all([
    readStateJson<SweepResponse["lastSweep"]>("last-sweep.json"),
    readRecentActions(),
    readRegisteredProcesses(),
  ]);

  const live = await liveStartTimes([...new Set(registry.processes.map((p) => p.pid))]);
  const processes: TrackedProcess[] = [];
  let staleCount = 0;

  for (const proc of registry.processes) {
    // Une heure illisible (processus système qui a recyclé le PID) ne prouve rien :
    // les processus de dev tournent sous l'utilisateur, leur heure est toujours lisible.
    if (sameStart(live.get(proc.pid), proc.startedAt)) processes.push(proc);
    else staleCount += 1;
  }

  return {
    lastSweep: lastSweep && Array.isArray(lastSweep.actions) ? lastSweep : null,
    recent,
    processes,
    staleCount,
    sandboxCount: registry.sandboxCount,
  };
}
