import { NextResponse } from "next/server";
import { deletePresentation, getPresentationById } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const presentation = await getPresentationById(id);
  if (!presentation) {
    return NextResponse.json({ error: "Presentation not found." }, { status: 404 });
  }
  return NextResponse.json({ presentation });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const removed = await deletePresentation(id);
  if (!removed) {
    return NextResponse.json({ error: "Presentation not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
