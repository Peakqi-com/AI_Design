import { NextResponse } from "next/server";
import { listPresentations, savePresentation } from "@/lib/crm/store";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";
import { PresentationDraft } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const linkedProjectId = url.searchParams.get("projectId")?.trim() || undefined;
  const userId = await resolveServerUserScopeId(requestedUserId);
  const presentations = await listPresentations({ userId, linkedProjectId });
  return NextResponse.json({ presentations });
}

type SaveBody = {
  id?: string;
  userId?: string;
  title?: string;
  designerName?: string;
  briefDesc?: string;
  linkedProjectId?: string;
  slides?: PresentationDraft["slides"];
  styleId?: string;
  step?: number;
};

export async function POST(request: Request) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestedUserId = String(body.userId || "").trim();
  const userId = await resolveServerUserScopeId(requestedUserId);

  try {
    const presentation = await savePresentation({
      id: body.id,
      userId,
      title: body.title || "未命名簡報",
      designerName: body.designerName,
      briefDesc: body.briefDesc,
      linkedProjectId: body.linkedProjectId,
      slides: Array.isArray(body.slides) ? body.slides : [],
      styleId: body.styleId,
      step: typeof body.step === "number" ? body.step : undefined,
    });
    return NextResponse.json({ presentation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save presentation failed.";
    if (message === "PRESENTATION_FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
