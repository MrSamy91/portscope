import "server-only";

import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { ServiceDefinition } from "@/lib/types";

const DATA_DIRECTORY = join(process.cwd(), "data");
const SERVICES_FILE = join(DATA_DIRECTORY, "services.json");
const LOGS_DIRECTORY = join(DATA_DIRECTORY, "logs");

interface StoredServices {
  services: ServiceDefinition[];
}

interface ServiceInput {
  name?: unknown;
  command?: unknown;
  cwd?: unknown;
  expectedPort?: unknown;
}

async function ensureDirectory() {
  await mkdir(DATA_DIRECTORY, { recursive: true });
}

async function saveServices(services: ServiceDefinition[]) {
  await ensureDirectory();
  await writeFile(
    SERVICES_FILE,
    JSON.stringify({ services } satisfies StoredServices, null, 2) + "\n",
    "utf8",
  );
}

export async function loadServices() {
  try {
    const raw = await readFile(SERVICES_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredServices>;
    return Array.isArray(parsed.services) ? parsed.services : [];
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

async function validateDirectory(input: string) {
  const cwd = resolve(input);
  let details;

  try {
    details = await stat(cwd);
  } catch {
    throw new Error("Le dossier de travail n’existe pas.");
  }

  if (!details.isDirectory()) {
    throw new Error("Le dossier de travail doit pointer vers un dossier.");
  }

  return cwd;
}

export async function createService(input: ServiceInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const command =
    typeof input.command === "string" ? input.command.trim() : "";
  const cwdInput = typeof input.cwd === "string" ? input.cwd.trim() : "";
  const expectedPort = Number(input.expectedPort);

  if (name.length < 2 || name.length > 60) {
    throw new Error("Le nom doit contenir entre 2 et 60 caractères.");
  }
  if (
    command.length < 2 ||
    command.length > 500 ||
    /[\r\n\0]/u.test(command)
  ) {
    throw new Error("La commande est invalide.");
  }
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) {
    throw new Error("Le port attendu doit être compris entre 1 et 65535.");
  }

  const cwd = await validateDirectory(cwdInput);
  const services = await loadServices();

  if (services.some((service) => service.expectedPort === expectedPort)) {
    throw new Error("Un lancement est déjà associé à ce port.");
  }

  const service: ServiceDefinition = {
    id: randomUUID(),
    name,
    command,
    cwd,
    expectedPort,
    createdAt: new Date().toISOString(),
    lastPid: null,
    lastStartedAt: null,
  };

  await saveServices([...services, service]);
  return service;
}

export async function deleteService(id: string) {
  const services = await loadServices();
  const filtered = services.filter((service) => service.id !== id);

  if (filtered.length === services.length) {
    throw new Error("Ce lancement enregistré n’existe plus.");
  }

  await saveServices(filtered);
}

export async function launchService(id: string) {
  const services = await loadServices();
  const service = services.find((item) => item.id === id);

  if (!service) {
    throw new Error("Ce lancement enregistré n’existe plus.");
  }

  await validateDirectory(service.cwd);
  await mkdir(LOGS_DIRECTORY, { recursive: true });
  const logPath = join(LOGS_DIRECTORY, service.id + ".log");
  const logDescriptor = openSync(logPath, "a");

  try {
    // La commande vient exclusivement de la configuration locale créée par l’utilisateur.
    const child = spawn(service.command, {
      cwd: service.cwd,
      detached: true,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", logDescriptor, logDescriptor],
    });

    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });

    child.unref();

    const lastStartedAt = new Date().toISOString();
    const updated = services.map((item) =>
      item.id === id
        ? {
            ...item,
            lastPid: child.pid ?? null,
            lastStartedAt,
          }
        : item,
    );

    await saveServices(updated);

    return {
      pid: child.pid ?? null,
      logPath,
      startedAt: lastStartedAt,
    };
  } finally {
    closeSync(logDescriptor);
  }
}
