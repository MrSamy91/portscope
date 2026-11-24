import { readAgentSweep } from "@/lib/agent-sweep";
import { assertLocalRequest, jsonError } from "@/lib/local-request";

export const dynamic = "force-dynamic";

// Lecture seule : Portscope affiche le tunnel, agent-sweep.ps1 reste le seul à agir.
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    return Response.json(await readAgentSweep(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
