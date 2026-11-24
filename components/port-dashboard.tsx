"use client";

import {
  ChevronDown,
  CircleStop,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AgentTunnel } from "@/components/agent-tunnel";
import { PortRadar } from "@/components/port-radar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  CpuSparkline,
  MemoryMeter,
  SAMPLE_INTERVAL_S,
  TopConsumers,
  type UsageHistory,
} from "@/components/usage-charts";
import {
  formatBytes,
  formatPercent,
  groupByProcess,
  type ProcessGroup,
} from "@/lib/process-groups";
import type { PortsResponse, ServiceDefinition, ServicesResponse } from "@/lib/types";

type Filter = "all" | "projects" | "network" | "system";
type Sort = "memory" | "cpu" | "port";
type ToastTone = "success" | "error" | "info";
type Confirmation =
  | { kind: "stop"; group: ProcessGroup }
  | { kind: "delete-service"; service: ServiceDefinition };

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "projects", label: "Projets" },
  { id: "network", label: "Exposés" },
  { id: "system", label: "Système" },
];

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "memory", label: "Mémoire" },
  { id: "cpu", label: "CPU" },
  { id: "port", label: "Port" },
];

/** 60 relevés × 5 s = les 5 dernières minutes. */
const HISTORY_LENGTH = 60;

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "L’opération a échoué.");
  return payload;
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatStartedAt(value: string | null) {
  if (!value) return "Heure inconnue";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function compactPath(value: string) {
  const parts = value.split(/[\\/]/u).filter(Boolean);
  return parts.length <= 2 ? value : "…\\" + parts.slice(-2).join("\\");
}

function addressLabel(addresses: string[], scope: "local" | "network") {
  if (scope === "local") return "Cette machine uniquement";
  if (addresses.some((address) => address === "0.0.0.0" || address === "::")) {
    return "Toutes les interfaces réseau";
  }
  return "Réseau local";
}

function rowId(key: string) {
  return "proc-" + key.replace(/[^a-z0-9]/giu, "-");
}

/** Ajoute le relevé courant à l'historique de chaque processus, et oublie ceux qui ont disparu. */
function appendHistory(previous: Map<string, UsageHistory>, groups: ProcessGroup[]) {
  const next = new Map<string, UsageHistory>();
  for (const group of groups) {
    const old = previous.get(group.key) ?? { cpu: [], memory: [] };
    next.set(group.key, {
      cpu: [...old.cpu, group.cpuPercent].slice(-HISTORY_LENGTH),
      memory: [...old.memory, group.memoryBytes].slice(-HISTORY_LENGTH),
    });
  }
  return next;
}

export function PortDashboard() {
  const [ports, setPorts] = useState<PortsResponse | null>(null);
  const [history, setHistory] = useState<Map<string, UsageHistory>>(() => new Map());
  const [services, setServices] = useState<ServiceDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("memory");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [showAddService, setShowAddService] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; tone: ToastTone; message: string } | null>(
    null,
  );

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 4200);
  }, []);

  const applySnapshot = useCallback((data: PortsResponse) => {
    setPorts(data);
    setHistory((previous) => appendHistory(previous, groupByProcess(data.entries)));
  }, []);

  const refreshPorts = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const response = await fetch("/api/ports", { cache: "no-store" });
        applySnapshot(await readJson<PortsResponse>(response));
      } catch (error) {
        notify(error instanceof Error ? error.message : "Impossible de relever les ports.", "error");
      } finally {
        if (!quiet) setRefreshing(false);
      }
    },
    [applySnapshot, notify],
  );

  const refreshServices = useCallback(async () => {
    try {
      const response = await fetch("/api/services", { cache: "no-store" });
      setServices((await readJson<ServicesResponse>(response)).services);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Impossible de charger les lancements.", "error");
    }
  }, [notify]);

  useEffect(() => {
    let cancelled = false;
    let followUp: number | undefined;

    void fetch("/api/ports", { cache: "no-store" })
      .then(readJson<PortsResponse>)
      .then((data) => {
        if (cancelled) return;
        applySnapshot(data);
        // Le CPU se mesure entre deux relevés : un second relevé rapide évite 5 s de « — ».
        followUp = window.setTimeout(() => void refreshPorts(true), 1500);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          notify(error instanceof Error ? error.message : "Impossible de relever les ports.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    void fetch("/api/services", { cache: "no-store" })
      .then(readJson<ServicesResponse>)
      .then((data) => {
        if (!cancelled) setServices(data.services);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      window.clearTimeout(followUp);
    };
  }, [applySnapshot, notify, refreshPorts]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refreshPorts(true), SAMPLE_INTERVAL_S * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshPorts]);

  useEffect(() => {
    if (!confirmation && !showAddService) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingConfirmation) {
        setConfirmation(null);
        setShowAddService(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmation, pendingConfirmation, showAddService]);

  const groups = useMemo(() => groupByProcess(ports?.entries ?? []), [ports?.entries]);

  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = groups.filter((group) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "projects" && group.project !== null) ||
        (filter === "network" && group.scope === "network") ||
        (filter === "system" && group.protected);
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return [
        group.pid,
        group.processName,
        group.project,
        group.sandbox,
        group.processPath,
        group.commandLine,
        ...group.ports.flatMap((entry) => [entry.port, ...entry.addresses]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
    return matches.sort((a, b) => {
      if (sort === "cpu") return (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
      if (sort === "port") return a.ports[0].port - b.ports[0].port;
      return (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1);
    });
  }, [filter, groups, query, sort]);

  // Échelles communes à toutes les lignes, pour que les barres et courbes se comparent entre elles.
  const memoryScale = Math.max(1024 ** 3, ...groups.map((group) => group.memoryBytes ?? 0));
  const cpuScale = useMemo(() => {
    let peak = 0;
    for (const item of history.values()) {
      for (const value of item.cpu) if (value !== null && value > peak) peak = value;
    }
    // Plancher à 10 % : sinon une machine au repos ferait passer 0,4 % pour un pic.
    return Math.max(10, Math.ceil(peak / 5) * 5);
  }, [history]);

  const totals = useMemo(() => {
    const memory = groups.reduce((sum, group) => sum + (group.memoryBytes ?? 0), 0);
    const measured = groups.filter((group) => group.cpuPercent !== null);
    const cpu = measured.length
      ? measured.reduce((sum, group) => sum + (group.cpuPercent ?? 0), 0)
      : null;
    return {
      memory,
      cpu,
      exposed: groups.filter((group) => group.scope === "network" && !group.protected).length,
      exposedSystem: groups.filter((group) => group.scope === "network" && group.protected).length,
      projects: groups.filter((group) => group.project !== null).length,
    };
  }, [groups]);

  const focusProcess = (key: string) => {
    setQuery("");
    setFilter("all");
    setHighlightKey(key);
    window.setTimeout(() => setHighlightKey((current) => (current === key ? null : current)), 2400);
    window.requestAnimationFrame(() => {
      document.getElementById(rowId(key))?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
    });
  };

  const createService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setBusyServiceId("new");
    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          command: formData.get("command"),
          cwd: formData.get("cwd"),
          expectedPort: formData.get("expectedPort"),
        }),
      });
      await readJson(response);
      await refreshServices();
      setShowAddService(false);
      form.reset();
      notify("Lancement enregistré.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Création impossible.", "error");
    } finally {
      setBusyServiceId(null);
    }
  };

  const startService = async (service: ServiceDefinition) => {
    setBusyServiceId(service.id);
    try {
      const response = await fetch("/api/services/" + service.id + "/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await readJson(response);
      notify(service.name + " démarre.", "success");
      await refreshServices();
      window.setTimeout(() => void refreshPorts(true), 1200);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lancement impossible.", "error");
    } finally {
      setBusyServiceId(null);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmation) return;
    setPendingConfirmation(true);
    try {
      if (confirmation.kind === "stop") {
        const { primary, label } = confirmation.group;
        const response = await fetch("/api/processes/" + primary.pid + "/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedName: primary.processName,
            expectedStartedAt: primary.startedAt,
          }),
        });
        await readJson(response);
        notify(label + " est arrêté.", "success");
        await refreshPorts(true);
      } else {
        const response = await fetch("/api/services/" + confirmation.service.id, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await readJson(response);
        notify("Lancement supprimé.", "success");
        await refreshServices();
      }
      setConfirmation(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Action impossible.", "error");
    } finally {
      setPendingConfirmation(false);
    }
  };

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="#">
          Portscope
        </a>
        <p className="topbar-status">
          <span className={"live-dot" + (autoRefresh ? " is-live" : "")} aria-hidden="true" />
          {ports
            ? "Relevé à " + formatClock(ports.scannedAt) + (autoRefresh ? " · toutes les 5 s" : " · en pause")
            : "Lecture en cours…"}
        </p>
        <div className="topbar-actions">
          <button
            className="action"
            aria-pressed={autoRefresh}
            onClick={() => setAutoRefresh((value) => !value)}
          >
            {autoRefresh ? "Mettre en pause" : "Reprendre"}
          </button>
          <button
            className="icon-action"
            onClick={() => void refreshPorts()}
            disabled={refreshing}
            aria-label="Actualiser maintenant"
            title="Actualiser maintenant"
          >
            <RefreshCw className={refreshing ? "spin" : ""} />
          </button>
          <ThemeToggle />
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">
          Machine locale
          {ports
            ? " · " + ports.machine.cpuCount + " cœurs · " + formatBytes(ports.machine.totalMemoryBytes) + " de RAM"
            : ""}
        </p>
        <h1>Ports et processus</h1>
        <p className="hero-copy">
          Ce qui écoute sur ta machine, ce que ça consomme, et de quoi l’arrêter proprement.
        </p>
      </section>

      <section className="stats" aria-label="Résumé">
        <div>
          <span>Processus</span>
          <strong>{groups.length}</strong>
          <small>dont {totals.projects} de tes projets</small>
        </div>
        <div>
          <span>Ports ouverts</span>
          <strong>{ports?.summary.total ?? 0}</strong>
          <small>TCP et UDP</small>
        </div>
        <div className={totals.exposed ? "is-warn" : ""}>
          <span>Exposés au réseau</span>
          <strong>{totals.exposed}</strong>
          <small>
            hors services Windows
            {totals.exposedSystem ? " (+" + totals.exposedSystem + ")" : ""}
          </small>
        </div>
        <div>
          <span>Mémoire</span>
          <strong>{formatBytes(totals.memory)}</strong>
          <small>
            {ports
              ? formatPercent((totals.memory / ports.machine.totalMemoryBytes) * 100) + " de la RAM"
              : "—"}
          </small>
        </div>
        <div>
          <span>CPU</span>
          <strong>{formatPercent(totals.cpu)}</strong>
          <small>de toute la machine</small>
        </div>
      </section>

      <div className="overview">
        <PortRadar groups={groups} onSelect={focusProcess} />
        <TopConsumers
          groups={groups}
          totalMemoryBytes={ports?.machine.totalMemoryBytes ?? 0}
          onSelect={focusProcess}
        />
      </div>

      <section className="panel processes" aria-labelledby="processes-title">
        <header className="panel-head">
          <div>
            <p className="eyebrow">{visibleGroups.length} sur {groups.length}</p>
            <h2 id="processes-title">Processus qui écoutent</h2>
          </div>
        </header>

        <div className="toolbar">
          <label className="search">
            <Search aria-hidden="true" />
            <span className="sr-only">Rechercher</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Port, projet, PID…"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche">
                <X />
              </button>
            ) : null}
          </label>
          <div className="segmented" role="group" aria-label="Filtrer">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Trier par">
            {SORTS.map((item) => (
              <button key={item.id} aria-pressed={sort === item.id} onClick={() => setSort(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="table" role="table" aria-label="Processus">
          <div className="table-head" role="row">
            <span role="columnheader">Processus</span>
            <span role="columnheader">Ports</span>
            <span
              role="columnheader"
              title={"5 dernières minutes, même échelle pour toutes les lignes (0 à " + cpuScale + " %)"}
            >
              CPU · 0–{cpuScale} %
            </span>
            <span role="columnheader">Mémoire</span>
            <span role="columnheader" className="sr-only">Actions</span>
          </div>

          {refreshing && !ports ? (
            <p className="table-empty">Lecture des écouteurs Windows…</p>
          ) : visibleGroups.length ? (
            visibleGroups.map((group) => {
              const isExpanded = expandedKey === group.key;
              const usage = history.get(group.key);
              const webPort = group.project
                ? group.ports.find((entry) => entry.protocol === "TCP")
                : undefined;
              return (
                <article
                  key={group.key}
                  id={rowId(group.key)}
                  className={
                    "row" +
                    (isExpanded ? " is-expanded" : "") +
                    (highlightKey === group.key ? " is-highlight" : "")
                  }
                  role="row"
                >
                  <div className="row-main">
                    <div className="cell-process" role="cell">
                      <strong>{group.label}</strong>
                      <small>
                        {[
                          group.project ? group.processName : null,
                          group.sandbox ? "sandbox " + group.sandbox : null,
                          "PID " + group.pid,
                          group.processCount > 1 ? group.processCount + " processus" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <div className="cell-ports" role="cell">
                      {group.ports.slice(0, 4).map((entry) => (
                        <span
                          key={entry.id}
                          className={"port-chip" + (entry.scope === "network" ? " is-network" : "")}
                          title={entry.protocol + " · " + entry.addresses.join(", ")}
                        >
                          :{entry.port}
                          {entry.protocol === "UDP" ? <em>udp</em> : null}
                        </span>
                      ))}
                      {group.ports.length > 4 ? (
                        <span className="port-chip is-more">+{group.ports.length - 4}</span>
                      ) : null}
                      {/* Un service Windows sur 0.0.0.0 est normal : l'alerte vise tes propres processus. */}
                      {group.scope === "network" && !group.protected ? (
                        <span className="exposure">Réseau</span>
                      ) : null}
                    </div>
                    <div className="cell-cpu" role="cell">
                      {/* Sur mobile, l'en-tête de tableau disparaît : chaque mesure porte son libellé. */}
                      <span className="cell-label">CPU</span>
                      <CpuSparkline
                        values={usage?.cpu ?? [group.cpuPercent]}
                        max={cpuScale}
                        current={group.cpuPercent}
                      />
                    </div>
                    <div className="cell-memory" role="cell">
                      <span className="cell-label">Mémoire</span>
                      <MemoryMeter bytes={group.memoryBytes} max={memoryScale} />
                    </div>
                    <div className="cell-actions" role="cell">
                      {webPort ? (
                        <a
                          className="icon-action"
                          href={"http://localhost:" + webPort.port}
                          target="_blank"
                          rel="noreferrer"
                          title={"Ouvrir http://localhost:" + webPort.port}
                          aria-label={"Ouvrir " + group.label + " dans le navigateur"}
                        >
                          <ExternalLink />
                        </a>
                      ) : null}
                      <button
                        className="icon-action"
                        onClick={() => setExpandedKey(isExpanded ? null : group.key)}
                        aria-expanded={isExpanded}
                        aria-label={(isExpanded ? "Masquer" : "Afficher") + " les détails de " + group.label}
                        title="Détails"
                      >
                        <ChevronDown className="chevron" />
                      </button>
                      <button
                        className="icon-action is-danger"
                        disabled={group.protected}
                        onClick={() => setConfirmation({ kind: "stop", group })}
                        title={group.protected ? "Processus protégé" : "Arrêter le processus"}
                        aria-label={
                          group.protected ? group.label + " est protégé" : "Arrêter " + group.label
                        }
                      >
                        {group.protected ? <LockKeyhole /> : <CircleStop />}
                      </button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <dl className="details">
                      <div>
                        <dt>Exécutable</dt>
                        <dd>{group.processPath ?? "Chemin non accessible"}</dd>
                      </div>
                      <div>
                        <dt>Commande</dt>
                        <dd>{group.commandLine ?? "Commande non accessible"}</dd>
                      </div>
                      <div>
                        <dt>Démarré</dt>
                        <dd>{formatStartedAt(group.startedAt)}</dd>
                      </div>
                      <div>
                        <dt>Connexions actives</dt>
                        <dd>{group.activeConnections}</dd>
                      </div>
                      <div className="details-wide">
                        <dt>Adresses</dt>
                        <dd>
                          {group.ports
                            .map(
                              (entry) =>
                                entry.protocol +
                                " :" +
                                entry.port +
                                " — " +
                                addressLabel(entry.addresses, entry.scope) +
                                " (" +
                                entry.addresses.join(", ") +
                                ")",
                            )
                            .join("\n")}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="table-empty">
              <p>Aucun processus ne correspond.</p>
              <button
                className="action"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Tout afficher
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="lower">
        <section className="panel" aria-labelledby="services-title">
          <header className="panel-head">
            <div>
              <p className="eyebrow">Raccourcis</p>
              <h2 id="services-title">Lancements</h2>
            </div>
            <button className="action" onClick={() => setShowAddService(true)}>
              <Plus /> Ajouter
            </button>
          </header>

          {services.length ? (
            <ul className="services">
              {services.map((service) => {
                const running = groups.find((group) =>
                  group.ports.some((entry) => entry.port === service.expectedPort),
                );
                const isBusy = busyServiceId === service.id;
                return (
                  <li key={service.id} className={running ? "is-running" : ""}>
                    <div className="service-info">
                      <strong>{service.name}</strong>
                      <small title={service.cwd}>
                        {compactPath(service.cwd)} · <code>{service.command}</code>
                      </small>
                    </div>
                    <span className="service-port">
                      :{service.expectedPort}
                      <em>{running ? "ouvert" : "arrêté"}</em>
                    </span>
                    <div className="service-actions">
                      {running ? (
                        <button
                          className="icon-action is-danger"
                          disabled={running.protected}
                          onClick={() => setConfirmation({ kind: "stop", group: running })}
                          aria-label={"Arrêter " + service.name}
                          title="Arrêter"
                        >
                          <Square />
                        </button>
                      ) : (
                        <button
                          className="icon-action"
                          onClick={() => void startService(service)}
                          disabled={isBusy}
                          aria-label={"Lancer " + service.name}
                          title="Lancer"
                        >
                          {isBusy ? <LoaderCircle className="spin" /> : <Play />}
                        </button>
                      )}
                      <button
                        className="icon-action"
                        onClick={() => setConfirmation({ kind: "delete-service", service })}
                        aria-label={"Supprimer le lancement " + service.name}
                        title="Supprimer ce raccourci"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="panel-empty">
              Enregistre une commande (par exemple <code>pnpm dev</code> dans un projet) pour la
              relancer d’un clic.
            </p>
          )}
        </section>

        <AgentTunnel />
      </div>

      <footer className="footnote">
        Tout reste sur cette machine : Portscope écoute sur 127.0.0.1, n’envoie rien dehors, masque
        les secrets des lignes de commande et refuse d’arrêter les processus Windows critiques.
      </footer>

      {showAddService ? (
        <div className="scrim" role="presentation">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-service-title"
          >
            <header className="dialog-head">
              <div>
                <p className="eyebrow">Nouveau raccourci</p>
                <h2 id="add-service-title">Enregistrer un lancement</h2>
              </div>
              <button
                className="icon-action"
                onClick={() => setShowAddService(false)}
                aria-label="Fermer"
              >
                <X />
              </button>
            </header>
            <p className="dialog-copy">
              La commande s’exécute dans le dossier choisi, uniquement quand tu cliques sur Lancer.
            </p>
            <form className="form" onSubmit={createService}>
              <label>
                <span>Nom</span>
                <input name="name" placeholder="BookingFlow" autoFocus required />
              </label>
              <label>
                <span>Commande</span>
                <input name="command" placeholder="pnpm dev" required />
              </label>
              <label>
                <span>Dossier de travail</span>
                <input name="cwd" placeholder="C:\dev\mon-projet" required />
              </label>
              <label>
                <span>Port attendu</span>
                <input name="expectedPort" type="number" min="1" max="65535" placeholder="3000" required />
              </label>
              <div className="dialog-actions">
                <button type="button" className="action" onClick={() => setShowAddService(false)}>
                  Annuler
                </button>
                <button className="action primary" disabled={busyServiceId === "new"}>
                  {busyServiceId === "new" ? <LoaderCircle className="spin" /> : null}
                  Enregistrer
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {confirmation ? (
        <div className="scrim" role="presentation">
          <section
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-description"
          >
            <p className="eyebrow">Confirmation</p>
            <h2 id="confirm-title">
              {confirmation.kind === "stop"
                ? "Arrêter " + confirmation.group.label + " ?"
                : "Supprimer ce lancement ?"}
            </h2>
            <p id="confirm-description" className="dialog-copy">
              {confirmation.kind === "stop"
                ? confirmation.group.processName +
                  " (PID " +
                  confirmation.group.pid +
                  ")" +
                  (confirmation.group.processCount > 1
                    ? " et ses " + (confirmation.group.processCount - 1) + " processus enfants seront arrêtés"
                    : " sera arrêté") +
                  ". Ports libérés : " +
                  confirmation.group.ports.map((entry) => ":" + entry.port).join(", ") +
                  "."
                : "Le raccourci " +
                  confirmation.service.name +
                  " sera retiré. Un processus en cours n’est pas arrêté."}
            </p>
            <div className="dialog-actions">
              <button
                className="action"
                disabled={pendingConfirmation}
                onClick={() => setConfirmation(null)}
              >
                Annuler
              </button>
              <button
                className="action danger"
                disabled={pendingConfirmation}
                onClick={() => void runConfirmedAction()}
                autoFocus
              >
                {pendingConfirmation ? <LoaderCircle className="spin" /> : null}
                {confirmation.kind === "stop" ? "Arrêter" : "Supprimer"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? (
        <div className={"toast toast-" + toast.tone} role="status">
          <p>{toast.message}</p>
          <button onClick={() => setToast(null)} aria-label="Fermer la notification">
            <X />
          </button>
        </div>
      ) : null}
    </main>
  );
}
