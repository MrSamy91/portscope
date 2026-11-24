"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { SweepAction, SweepResponse } from "@/lib/types";

const KIND_LABELS: Record<string, string> = {
  "kill-orphan": "Orphelin tué",
  "remove-worktree": "Worktree rangé",
  "out-of-rule": "Hors règle",
  "purge-tmp": "Clone temp purgé",
  prune: "Worktrees purgés",
};

// Le sweep tourne toutes les 2 h (tâche planifiée agent-sweep).
const SWEEP_INTERVAL_MS = 2 * 3600 * 1000;

function formatTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortTarget(target: string) {
  // "repo: C:\long\chemin\dossier" → "repo · …\dossier"
  const [repo, path] = target.includes(": ") ? target.split(/: (.+)/u) : ["", target];
  const tail = path.split(/[\\/]/u).filter(Boolean).slice(-2).join("\\");
  return (repo ? repo + " · " : "") + "…\\" + tail;
}

function ActionRow({ action }: { action: SweepAction }) {
  return (
    <li className={"is-" + action.status}>
      <span className="log-kind">{KIND_LABELS[action.kind] ?? action.kind}</span>
      <span className="log-target" title={action.target + (action.detail ? "\n" + action.detail : "")}>
        {shortTarget(action.target)}
      </span>
      <time className="log-time" dateTime={action.at}>{formatTime(action.at)}</time>
    </li>
  );
}

export function AgentTunnel() {
  const [data, setData] = useState<SweepResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/sweep", { cache: "no-store" });
      const payload = (await response.json()) as SweepResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Lecture du tunnel impossible.");
      setData(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lecture du tunnel impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Chargement initial puis toutes les 30 s : le journal bouge peu, inutile de suivre le rythme des ports.
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  const outOfRule = data?.lastSweep?.actions.filter((a) => a.kind === "out-of-rule") ?? [];
  const killed = data?.recent.filter((a) => a.kind === "kill-orphan" && a.status === "done").length ?? 0;
  const removed = data?.recent.filter((a) => a.kind === "remove-worktree" && a.status === "done").length ?? 0;
  const failed = data?.recent.filter((a) => a.status === "failed").length ?? 0;
  const nextSweep = data?.lastSweep
    ? new Date(new Date(data.lastSweep.at).getTime() + SWEEP_INTERVAL_MS).toISOString()
    : null;

  return (
    <section className="panel tunnel" aria-labelledby="tunnel-title">
      <header className="panel-head">
        <div>
          <p className="eyebrow">
            {data?.lastSweep
              ? "Passage " + formatTime(data.lastSweep.at) +
                (nextSweep ? " · prochain vers " + formatTime(nextSweep) : "")
              : "Nettoyage toutes les 2 h"}
          </p>
          <h2 id="tunnel-title">Tunnel des agents</h2>
        </div>
        <button
          className="icon-action"
          onClick={() => void load()}
          disabled={loading}
          title="Relire le journal"
          aria-label="Relire le journal du nettoyage"
        >
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </header>

      {error ? <p className="panel-error">{error}</p> : null}

      <dl className="mini-stats">
        <div><dt>Suivis</dt><dd>{data?.processes.length ?? 0}</dd></div>
        <div><dt>Orphelins tués · 7 j</dt><dd>{killed}</dd></div>
        <div><dt>Worktrees rangés · 7 j</dt><dd>{removed}</dd></div>
        <div className={outOfRule.length ? "is-warn" : ""}><dt>Hors règle</dt><dd>{outOfRule.length}</dd></div>
        {failed ? <div className="is-danger"><dt>Échecs</dt><dd>{failed}</dd></div> : null}
      </dl>

      {data?.processes.length ? (
        <ul className="log">
          {data.processes.map((proc) => (
            <li key={proc.sandbox + proc.name + proc.pid}>
              <span className="log-kind">{proc.repo} / {proc.sandbox}</span>
              <span className="log-target">{proc.name} · PID {proc.pid}</span>
              <span className="log-time">{proc.port ? ":" + proc.port : "—"}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {outOfRule.length || data?.recent.length ? (
        <ul className="log">
          {outOfRule.map((action) => (
            <ActionRow action={action} key={"oor" + action.target} />
          ))}
          {data?.recent.map((action) => (
            <ActionRow action={action} key={action.at + action.target} />
          ))}
        </ul>
      ) : (
        <p className="panel-empty">Rien à signaler sur les 7 derniers jours.</p>
      )}

      {data?.staleCount ? (
        <p className="panel-foot">
          {data.staleCount} entrée(s) du registre visent des processus terminés ({data.sandboxCount} sandboxes).
        </p>
      ) : null}
    </section>
  );
}
