import { assertLocalRequest, jsonError } from "@/lib/local-request";
import { launchService, loadServices } from "@/lib/services-store";
import { listWindowsPorts } from "@/lib/windows-ports";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertLocalRequest(request, true);
    await request.json();
    const { id } = await context.params;
    const services = await loadServices();
    const service = services.find((item) => item.id === id);

    if (!service) {
      return Response.json(
        { error: "Ce lancement enregistré n’existe plus." },
        { status: 404 },
      );
    }

    const ports = await listWindowsPorts();
    if (ports.entries.some((entry) => entry.port === service.expectedPort)) {
      return Response.json(
        {
          error:
            "Le port attendu est déjà ouvert. Arrête le processus existant avant de relancer ce service.",
        },
        { status: 409 },
      );
    }

    return Response.json(await launchService(id), { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
