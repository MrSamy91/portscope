import { assertLocalRequest, jsonError } from "@/lib/local-request";
import { sameStart } from "@/lib/sandbox-registry";
import {
  getWindowsProcessIdentity,
  isProtectedProcess,
  stopWindowsProcess,
} from "@/lib/windows-ports";

interface RouteContext {
  params: Promise<{ pid: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertLocalRequest(request, true);
    const { pid: rawPid } = await context.params;
    const pid = Number(rawPid);
    const body = (await request.json()) as {
      expectedName?: unknown;
      expectedStartedAt?: unknown;
    };
    const expectedName =
      typeof body.expectedName === "string" ? body.expectedName.trim() : "";
    const expectedStartedAt =
      typeof body.expectedStartedAt === "string" ? body.expectedStartedAt : null;

    if (!Number.isInteger(pid) || pid < 1 || !expectedName) {
      return Response.json(
        { error: "Le processus à arrêter est invalide." },
        { status: 400 },
      );
    }

    const currentProcess = await getWindowsProcessIdentity(pid);

    // Le nom seul ne suffit pas : un autre `node` peut avoir récupéré le PID entre-temps.
    // L'heure de démarrage, elle, identifie le processus de façon unique.
    if (
      currentProcess.name.toLowerCase() !== expectedName.toLowerCase() ||
      (expectedStartedAt !== null && !sameStart(currentProcess.startedAt, expectedStartedAt))
    ) {
      return Response.json(
        {
          error:
            "Le PID a changé de processus depuis le dernier relevé. Actualise avant de continuer.",
        },
        { status: 409 },
      );
    }

    if (isProtectedProcess(pid, currentProcess.name, currentProcess.path)) {
      return Response.json(
        { error: "Ce processus système est protégé et ne peut pas être arrêté ici." },
        { status: 403 },
      );
    }

    await stopWindowsProcess(pid);
    return Response.json({ stopped: true, pid });
  } catch (error) {
    return jsonError(error);
  }
}
