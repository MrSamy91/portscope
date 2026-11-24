"use client";

import { formatBytes, type ProcessGroup } from "@/lib/process-groups";

const MAX_DOTS = 48;

/** Hash stable d'une clé : un processus garde sa place sur le radar d'un relevé à l'autre. */
function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Radar : l'anneau intérieur = local uniquement, l'anneau extérieur = joignable depuis le réseau.
 * La taille d'un point suit la mémoire (échelle racine : l'aire est proportionnelle).
 */
export function PortRadar({
  groups,
  onSelect,
}: {
  groups: ProcessGroup[];
  onSelect: (key: string) => void;
}) {
  const visible = [...groups]
    .sort((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0))
    .slice(0, MAX_DOTS);
  const maxMemory = Math.max(1, ...visible.map((group) => group.memoryBytes ?? 0));
  // Étiquettes directes seulement pour les 3 plus gros : au-delà, ça devient illisible.
  const labelled = new Set(visible.slice(0, 3).map((group) => group.key));
  // Même définition que la statistique du haut : les services Windows exposés sont normaux.
  const exposed = groups.filter((group) => group.scope === "network" && !group.protected).length;

  return (
    <section className="panel radar-panel" aria-labelledby="radar-title">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Radar</p>
          <h2 id="radar-title">Qui écoute, et d’où</h2>
        </div>
        <p className="radar-count">
          <strong>{exposed}</strong> exposé{exposed > 1 ? "s" : ""} au réseau
        </p>
      </header>

      <div className="radar">
        <div className="radar-sweep" aria-hidden="true" />
        <span className="radar-ring radar-ring-outer" aria-hidden="true" />
        <span className="radar-ring radar-ring-inner" aria-hidden="true" />
        <span className="radar-ring radar-ring-core" aria-hidden="true" />
        <span className="radar-axis radar-axis-h" aria-hidden="true" />
        <span className="radar-axis radar-axis-v" aria-hidden="true" />
        <span className="radar-zone radar-zone-network" aria-hidden="true">Réseau</span>
        <span className="radar-zone radar-zone-local" aria-hidden="true">Local</span>

        {visible.map((group) => {
          const seed = hash(group.key);
          const angle = ((seed % 3600) / 10) * (Math.PI / 180);
          const radius = (group.scope === "network" ? 39 : 23) + ((seed >> 12) % 7) - 3;
          const left = 50 + Math.cos(angle) * radius;
          const top = 50 + Math.sin(angle) * radius;
          const size = 7 + Math.sqrt((group.memoryBytes ?? 0) / maxMemory) * 15;
          const ports = group.ports.map((entry) => ":" + entry.port).join(" ");

          return (
            <button
              key={group.key}
              className={
                "radar-dot radar-dot-" + group.scope + (group.protected ? " is-protected" : "")
              }
              style={{ left: left + "%", top: top + "%", width: size, height: size }}
              onClick={() => onSelect(group.key)}
              title={group.label + " · " + ports + " · " + formatBytes(group.memoryBytes)}
              aria-label={"Voir " + group.label + " (" + ports + ")"}
            >
              {labelled.has(group.key) ? (
                <span className={"radar-label" + (left > 62 ? " is-left" : "")}>{group.label}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <ul className="legend" aria-label="Légende">
        <li><i className="legend-dot legend-local" /> Local</li>
        <li><i className="legend-dot legend-network" /> Réseau</li>
        <li><i className="legend-dot legend-protected" /> Système</li>
        <li className="legend-note">Taille = mémoire</li>
      </ul>
    </section>
  );
}
