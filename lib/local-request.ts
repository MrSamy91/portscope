const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class LocalRequestError extends Error {
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
    this.name = "LocalRequestError";
  }
}

function hostnameFromHostHeader(host: string | null) {
  if (!host) return null;

  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopback(hostname: string | null) {
  return hostname !== null && LOOPBACK_HOSTS.has(hostname);
}

export function assertLocalRequest(request: Request, mutation = false) {
  const hostHeader = request.headers.get("host");
  const hostname = hostnameFromHostHeader(hostHeader);

  if (!isLoopback(hostname)) {
    throw new LocalRequestError(
      "Portscope accepte uniquement les requêtes provenant de cette machine.",
    );
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new LocalRequestError("Origine de requête invalide.");
    }

    if (!isLoopback(originUrl.hostname) || originUrl.host !== hostHeader) {
      throw new LocalRequestError("Les requêtes externes sont refusées.");
    }
  }

  if (mutation) {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new LocalRequestError("Le contenu de la requête doit être du JSON.", 415);
    }
  }
}

export function jsonError(error: unknown, fallbackStatus = 500) {
  if (error instanceof LocalRequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  const message =
    error instanceof Error
      ? error.message
      : "Une erreur inattendue a interrompu l’opération.";

  return Response.json({ error: message }, { status: fallbackStatus });
}
