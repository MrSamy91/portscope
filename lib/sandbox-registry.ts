import "server-only";

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Dossier d'état partagé par worktree-sandbox (registre) et agent-sweep.ps1 (journal).
export const STATE_DIR = join(homedir(), ".agents", "worktree-sandbox");
// Même tolérance que agent-sweep.ps1 : un PID recyclé par Windows n'a pas la même heure de démarrage.
export const START_TOLERANCE_MS = 2000;

export interface RegisteredProcess {
  sandbox: string;
  repo: string;
  name: string;
  pid: number;
  port: number | null;
  startedAt: string | null;
}

interface RegistrySandbox {
  repoName?: string;
  sandboxId?: string;
  processes?: Record<string, { name?: string; pid?: number; port?: number | null; startedAt?: string }>;
}

// Les fichiers écrits par PowerShell 5.1 commencent par un BOM UTF-8 que JSON.parse refuse.
export async function readStateText(file: string) {
  try {
    return (await readFile(join(STATE_DIR, file), "utf8")).replace(/^﻿/u, "");
  } catch {
    return null;
  }
}

export async function readStateJson<T>(file: string): Promise<T | null> {
  const text = await readStateText(file);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Tous les processus inscrits par `sandbox.py start-process`, vivants ou non. */
export async function readRegisteredProcesses() {
  const registry = await readStateJson<{ sandboxes?: Record<string, RegistrySandbox> }>(
    "registry.json",
  );
  const sandboxes = Object.values(registry?.sandboxes ?? {});
  const processes: RegisteredProcess[] = sandboxes.flatMap((sandbox) =>
    Object.values(sandbox.processes ?? {}).flatMap((proc) =>
      typeof proc.pid === "number"
        ? [
            {
              sandbox: sandbox.sandboxId ?? "?",
              repo: sandbox.repoName ?? "?",
              name: proc.name ?? "process",
              pid: proc.pid,
              port: proc.port ?? null,
              startedAt: proc.startedAt ?? null,
            },
          ]
        : [],
    ),
  );
  return { processes, sandboxCount: sandboxes.length };
}

/** Vrai si l'heure réelle correspond à celle inscrite (absence d'heure inscrite = on fait confiance au PID). */
export function sameStart(liveStart: string | null | undefined, registeredStart: string | null) {
  if (typeof liveStart !== "string") return false;
  if (!registeredStart) return true;
  return (
    Math.abs(new Date(liveStart).getTime() - new Date(registeredStart).getTime()) <=
    START_TOLERANCE_MS
  );
}

const SEP = String.raw`[\\/]`;
const SEG = String.raw`([^\\/"'\s]+)`;
// Ordre = du plus précis au plus général ; le premier qui matche gagne.
const PROJECT_PATTERNS: Array<{
  re: RegExp;
  pick: (m: RegExpExecArray) => { project: string; sandbox: string | null };
}> = [
  {
    re: new RegExp(String.raw`[a-z]:${SEP}dev${SEP}sandboxes${SEP}${SEG}${SEP}${SEG}`, "iu"),
    pick: (m) => ({ project: m[1], sandbox: m[2] }),
  },
  {
    re: new RegExp(String.raw`[a-z]:${SEP}dev${SEP}${SEG}-worktrees${SEP}${SEG}`, "iu"),
    pick: (m) => ({ project: m[1], sandbox: m[2] }),
  },
  {
    re: new RegExp(String.raw`[a-z]:${SEP}dev${SEP}${SEG}${SEP}\.claude${SEP}worktrees${SEP}${SEG}`, "iu"),
    pick: (m) => ({ project: m[1], sandbox: m[2] }),
  },
  {
    // ~/.codex/worktrees/<hash>/<repo>
    re: new RegExp(String.raw`${SEP}\.codex${SEP}worktrees${SEP}${SEG}${SEP}${SEG}`, "iu"),
    pick: (m) => ({ project: m[2], sandbox: "codex " + m[1] }),
  },
  {
    re: new RegExp(String.raw`[a-z]:${SEP}dev${SEP}${SEG}`, "iu"),
    pick: (m) => ({ project: m[1], sandbox: null }),
  },
];

/**
 * Projet (et worktree éventuel) déduit des lignes de commande du processus puis de ses parents.
 * On s'arrête à la première ligne qui désigne un projet : la plus proche du processus.
 */
export function detectProject(chain: string[] | null) {
  for (const line of chain ?? []) {
    for (const { re, pick } of PROJECT_PATTERNS) {
      const match = re.exec(line);
      if (match) return pick(match);
    }
  }
  return null;
}
