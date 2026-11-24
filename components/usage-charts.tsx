"use client";

import { useState } from "react";

import { formatBytes, formatPercent, type ProcessGroup } from "@/lib/process-groups";

/** Intervalle entre deux relevés (doit suivre le rafraîchissement du tableau de bord). */
export const SAMPLE_INTERVAL_S = 5;

export interface UsageHistory {
  cpu: Array<number | null>;
  memory: Array<number | null>;
}

function agoLabel(stepsBack: number) {
  if (stepsBack === 0) return "maintenant";
  const seconds = stepsBack * SAMPLE_INTERVAL_S;
  return seconds < 60 ? "il y a " + seconds + " s" : "il y a " + Math.round(seconds / 60) + " min";
}

/**
 * Courbe CPU d'une ligne. Toutes les lignes partagent la même échelle (`max`) :
 * deux courbes de même hauteur représentent la même charge.
 * Au survol, la valeur affichée devient celle du point pointé.
 */
export function CpuSparkline({
  values,
  max,
  current,
}: {
  values: Array<number | null>;
  max: number;
  current: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 100;
  const height = 28;
  const slots = Math.max(values.length, 2);
  const x = (index: number) => (index / (slots - 1)) * width;
  const y = (value: number) => height - 2 - (Math.min(value, max) / max) * (height - 4);

  // Les trous (relevé sans valeur) coupent la courbe au lieu d'inventer une valeur.
  const segments: string[] = [];
  let currentSegment = "";
  values.forEach((value, index) => {
    if (value === null) {
      if (currentSegment) segments.push(currentSegment);
      currentSegment = "";
      return;
    }
    currentSegment += (currentSegment ? " L" : "M") + x(index).toFixed(2) + " " + y(value).toFixed(2);
  });
  if (currentSegment) segments.push(currentSegment);

  const shown = hover !== null ? values[hover] ?? null : current;
  const hoverLabel = hover !== null ? agoLabel(values.length - 1 - hover) : null;
  const known = values.filter((value): value is number => value !== null);
  const average = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;

  return (
    <div className="spark">
      <svg
        className="spark-plot"
        viewBox={"0 0 " + width + " " + height}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          "CPU " + formatPercent(current) + ", moyenne " + formatPercent(average) + " sur les derniers relevés"
        }
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          const index = Math.round(ratio * (slots - 1));
          setHover(index >= 0 && index < values.length ? index : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line className="spark-base" x1="0" x2={width} y1={height - 2} y2={height - 2} />
        {segments.map((d) => (
          <path className="spark-line" d={d} key={d} />
        ))}
        {hover !== null && values[hover] !== null ? (
          <line className="spark-cursor" x1={x(hover)} x2={x(hover)} y1="0" y2={height} />
        ) : null}
      </svg>
      <span className="spark-value">
        <strong>{formatPercent(shown)}</strong>
        {hoverLabel ? <small>{hoverLabel}</small> : null}
      </span>
    </div>
  );
}

/** Jauge mémoire horizontale ; `max` est commun à toutes les lignes. */
export function MemoryMeter({ bytes, max }: { bytes: number | null; max: number }) {
  const ratio = bytes === null || max <= 0 ? 0 : Math.min(1, bytes / max);
  return (
    <div className="meter">
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: (ratio * 100).toFixed(1) + "%" }} />
      </span>
      <strong>{formatBytes(bytes)}</strong>
    </div>
  );
}

type Metric = "memory" | "cpu";

/**
 * Classement des plus gros consommateurs. Une seule mesure à la fois (jamais deux échelles
 * sur un même graphique) : on bascule Mémoire / CPU.
 */
export function TopConsumers({
  groups,
  totalMemoryBytes,
  onSelect,
}: {
  groups: ProcessGroup[];
  totalMemoryBytes: number;
  onSelect: (key: string) => void;
}) {
  const [metric, setMetric] = useState<Metric>("memory");
  const valueOf = (group: ProcessGroup) =>
    metric === "memory" ? group.memoryBytes ?? 0 : group.cpuPercent ?? 0;
  const ranked = [...groups]
    .filter((group) => valueOf(group) > 0)
    .sort((a, b) => valueOf(b) - valueOf(a))
    .slice(0, 7);
  // CPU : échelle fixe à 100 % de la machine. Mémoire : relative au plus gros, avec un plancher
  // de 1 Go pour qu'un 80 Mo ne remplisse pas toute la barre quand rien ne consomme.
  const scale =
    metric === "cpu" ? 100 : Math.max(1024 ** 3, ...ranked.map((group) => group.memoryBytes ?? 0));

  return (
    <section className="panel consumers" aria-labelledby="consumers-title">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Consommation</p>
          <h2 id="consumers-title">Ce qui pèse le plus</h2>
        </div>
        <div className="segmented" role="group" aria-label="Mesure affichée">
          <button aria-pressed={metric === "memory"} onClick={() => setMetric("memory")}>
            Mémoire
          </button>
          <button aria-pressed={metric === "cpu"} onClick={() => setMetric("cpu")}>
            CPU
          </button>
        </div>
      </header>

      {ranked.length ? (
        <ol className="bars">
          {ranked.map((group) => {
            const value = valueOf(group);
            const share =
              metric === "memory" && totalMemoryBytes
                ? " · " + formatPercent((value / totalMemoryBytes) * 100) + " de la RAM"
                : "";
            return (
              <li key={group.key}>
                <button
                  className="bar-row"
                  onClick={() => onSelect(group.key)}
                  title={group.label + " : " + (metric === "memory" ? formatBytes(value) : formatPercent(value)) + share}
                >
                  <span className="bar-label">
                    <strong>{group.label}</strong>
                    <small>{group.project ? group.processName : "PID " + group.pid}</small>
                  </span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ width: Math.max(1.5, (value / scale) * 100).toFixed(1) + "%" }} />
                  </span>
                  <span className="bar-value">
                    {metric === "memory" ? formatBytes(value) : formatPercent(value)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="panel-empty">
          {metric === "cpu" ? "Mesure du CPU au prochain relevé…" : "Aucune donnée de mémoire."}
        </p>
      )}
      <p className="panel-foot">
        {metric === "cpu"
          ? "Part de toute la machine, mesurée entre deux relevés."
          : "Processus et ses enfants · barre relative au plus gros (min. 1 Go)."}
      </p>
    </section>
  );
}
