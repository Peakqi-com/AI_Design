import { NextResponse } from "next/server";
import { deletePresentation, getPresentationById } from "@/lib/crm/store";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const requestedUserId = new URL(request.url).searchParams.get("userId")?.trim() || "";
  const userId = await resolveServerUserScopeId(requestedUserId);
  const presentation = await getPresentationById(id, userId);
  if (!presentation) {
    return NextResponse.json({ error: "Presentation not found." }, { status: 404 });
  }
  return NextResponse.json({ presentation });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const requestedUserId = new URL(request.url).searchParams.get("userId")?.trim() || "";
  const userId = await resolveServerUserScopeId(requestedUserId);
  const removed = await deletePresentation(id, userId);
  if (!removed) {
    return NextResponse.json({ error: "Presentation not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
