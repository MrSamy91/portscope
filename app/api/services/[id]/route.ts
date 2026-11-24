import { assertLocalRequest, jsonError } from "@/lib/local-request";
import { deleteService } from "@/lib/services-store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertLocalRequest(request, true);
    const { id } = await context.params;

    if (!id) {
      return Response.json({ error: "Identifiant manquant." }, { status: 400 });
    }

    await deleteService(id);
    return Response.json({ deleted: true });
  } catch (error) {
    return jsonError(error, 400);
  }
}
