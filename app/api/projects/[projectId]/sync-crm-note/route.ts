import { NextResponse } from "next/server";
import { syncProjectNoteToCrm } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  try {
    const result = await syncProjectNoteToCrm(projectId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync CRM note failed.";
    const statusCode = /not found/i.test(message)
      ? 404
      : /empty|no linked/i.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
