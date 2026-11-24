import { assertLocalRequest, jsonError } from "@/lib/local-request";
import { createService, loadServices } from "@/lib/services-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    return Response.json(
      { services: await loadServices() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const service = await createService(await request.json());
    return Response.json({ service }, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
