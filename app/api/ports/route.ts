import { assertLocalRequest, jsonError } from "@/lib/local-request";
import { listWindowsPorts } from "@/lib/windows-ports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    return Response.json(await listWindowsPorts(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
