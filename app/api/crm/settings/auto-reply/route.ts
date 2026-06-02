import { NextResponse } from "next/server";
import { getAutoReplyConfig, saveAutoReplyConfig } from "@/lib/crm/store";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";
import { LineAutoReplyConfig } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  const config = await getAutoReplyConfig(userScopeId);
  return NextResponse.json({ config });
}

type SaveBody = { userId?: string; config?: LineAutoReplyConfig };

export async function PUT(request: Request) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const userScopeId = await resolveServerUserScopeId((body.userId || "").trim());
  const config = await saveAutoReplyConfig(userScopeId, body.config || {});
  return NextResponse.json({ config });
}
