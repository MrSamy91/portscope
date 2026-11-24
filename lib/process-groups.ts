import type { PortEntry, PortScope } from "@/lib/types";

/**
 * Un processus et tous les ports qu'il ouvre. L'écran raisonne en processus,
 * pas en ports : c'est le processus qui consomme et c'est lui qu'on arrête.
 */
export interface ProcessGroup {
  /** PID + heure de démarrage : stable tant que le processus vit, jamais réutilisé. */
  key: string;
  pid: number;
  label: string;
  processName: string;
  project: string | null;
  sandbox: string | null;
  trackedAs: string | null;
  processPath: string | null;
  commandLine: string | null;
  startedAt: string | null;
  memoryBytes: number | null;
  cpuPercent: number | null;
  processCount: number;
  activeConnections: number;
  scope: PortScope;
  protected: boolean;
  ports: PortEntry[];
  /** Entrée de référence pour l'arrêt (nom + heure de démarrage vérifiés côté serveur). */
  primary: PortEntry;
}

export function processKey(pid: number, startedAt: string | null) {
  return pid + ":" + (startedAt ?? "");
}

export function groupByProcess(entries: PortEntry[]): ProcessGroup[] {
  const groups = new Map<string, ProcessGroup>();

  for (const entry of entries) {
    const key = processKey(entry.pid, entry.startedAt);
    const existing = groups.get(key);
    if (existing) {
      existing.ports.push(entry);
      existing.activeConnections += entry.activeConnections;
      if (entry.scope === "network") existing.scope = "network";
      continue;
    }
    groups.set(key, {
      key,
      pid: entry.pid,
      label: entry.project ?? entry.processName,
      processName: entry.processName,
      project: entry.project,
      sandbox: entry.sandbox,
      trackedAs: entry.trackedAs,
      processPath: entry.processPath,
      commandLine: entry.commandLine,
      startedAt: entry.startedAt,
      memoryBytes: entry.memoryBytes,
      cpuPercent: entry.cpuPercent,
      processCount: entry.processCount,
      activeConnections: entry.activeConnections,
      scope: entry.scope,
      protected: entry.protected,
      ports: [entry],
      primary: entry,
    });
  }

  for (const group of groups.values()) {
    group.ports.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
  }
  return Array.from(groups.values());
}

export function formatBytes(bytes: number | null) {
  if (bytes === null) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1).replace(".", ",") + " Go";
  if (mb >= 1) return Math.round(mb) + " Mo";
  return Math.round(bytes / 1024) + " Ko";
}

export function formatPercent(value: number | null) {
  if (value === null) return "—";
  if (value > 0 && value < 0.1) return "<0,1 %";
  return value.toFixed(value >= 10 ? 0 : 1).replace(".", ",") + " %";
}
