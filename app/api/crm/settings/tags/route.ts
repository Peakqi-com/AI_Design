import { NextResponse } from "next/server";
import { getTagDefinitions, saveTagDefinitions } from "@/lib/crm/store";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";
import { TagDefinition } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  const tags = await getTagDefinitions(userScopeId);
  return NextResponse.json({ tags });
}

type SaveBody = { userId?: string; tags?: TagDefinition[] };

export async function PUT(request: Request) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const userScopeId = await resolveServerUserScopeId((body.userId || "").trim());
  const tags = await saveTagDefinitions(userScopeId, Array.isArray(body.tags) ? body.tags : []);
  return NextResponse.json({ tags });
}
