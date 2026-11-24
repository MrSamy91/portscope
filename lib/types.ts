export type PortProtocol = "TCP" | "UDP";
export type PortScope = "local" | "network";

export interface PortEntry {
  id: string;
  protocol: PortProtocol;
  port: number;
  addresses: string[];
  pid: number;
  processName: string;
  processPath: string | null;
  commandLine: string | null;
  startedAt: string | null;
  /** Mémoire de travail du processus ET de ses descendants. */
  memoryBytes: number | null;
  /** % CPU de l'arbre, rapporté à toute la machine (0–100). Null au premier relevé. */
  cpuPercent: number | null;
  /** Nombre de processus dans l'arbre (lui + descendants). */
  processCount: number;
  activeConnections: number;
  scope: PortScope;
  protected: boolean;
  /** Dossier de C:\dev déduit de la commande du processus ou de ses parents. */
  project: string | null;
  /** Worktree ou sandbox (sandboxes, <repo>-worktrees, .claude/.codex worktrees). */
  sandbox: string | null;
  /** Nom du processus suivi par `sandbox.py start-process`, si c'est lui. */
  trackedAs: string | null;
}

export interface PortsResponse {
  platform: string;
  scannedAt: string;
  machine: { cpuCount: number; totalMemoryBytes: number };
  entries: PortEntry[];
  summary: {
    total: number;
    applications: number;
    exposed: number;
    activeConnections: number;
  };
}

export interface ServiceDefinition {
  id: string;
  name: string;
  command: string;
  cwd: string;
  expectedPort: number;
  createdAt: string;
  lastPid: number | null;
  lastStartedAt: string | null;
}

export interface ServicesResponse {
  services: ServiceDefinition[];
}

/** Une ligne écrite par agent-sweep.ps1 (skill worktree-sandbox). */
export interface SweepAction {
  at: string;
  mode: string;
  kind: string;
  target: string;
  status: string;
  detail: string;
}

/** Processus vivant lancé via `sandbox.py start-process`. */
export interface TrackedProcess {
  sandbox: string;
  repo: string;
  name: string;
  pid: number;
  port: number | null;
  startedAt: string | null;
}

export interface SweepResponse {
  lastSweep: { at: string; mode: string; actions: SweepAction[] } | null;
  /** Actions faites (done/failed) des 7 derniers jours, plus récentes d'abord. */
  recent: SweepAction[];
  processes: TrackedProcess[];
  /** Entrées du registre dont le processus n'existe plus. */
  staleCount: number;
  sandboxCount: number;
}
