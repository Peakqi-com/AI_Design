import { NextResponse } from "next/server";
import {
  ContentVaultKind,
  deleteContentVaultItem,
  listContentVaultItems,
  saveContentVaultItem,
} from "@/lib/content/vault";
import { resolveServerUserScopeCandidates, resolveServerUserScopeId } from "@/lib/server/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND_SET = new Set<ContentVaultKind>(["marketing-state", "social-post", "general"]);

type SaveBody = {
  id?: string;
  userId?: string;
  kind?: ContentVaultKind;
  title?: string;
  summary?: string;
  payload?: unknown;
  upsertKey?: string;
};

type DeleteBody = {
  userId?: string;
  id?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopes = await resolveServerUserScopeCandidates(requestedUserId);
  const kindRaw = url.searchParams.get("kind")?.trim() || "";
  const kind = kindRaw && KIND_SET.has(kindRaw as ContentVaultKind) ? (kindRaw as ContentVaultKind) : undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const includeDeleted = url.searchParams.get("includeDeleted") === "1";
  const limit = Number(url.searchParams.get("limit") || 40);
  try {
    const listResults = await Promise.all(
      userScopes.map((scopeId) =>
        listContentVaultItems({
          userId: scopeId,
          kind,
          includeArchived,
          includeDeleted,
          limit,
        }),
      ),
    );
    const merged = listResults
      .flat()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const uniq = new Map<string, (typeof merged)[number]>();
    for (const item of merged) {
      if (!uniq.has(item.id)) {
        uniq.set(item.id, item);
      }
    }
    return NextResponse.json({ items: Array.from(uniq.values()).slice(0, limit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "List content vault failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const requestedUserId = body.userId?.trim() || "";
  const kind = body.kind;
  const title = body.title?.trim() || "";
  if (!kind || !KIND_SET.has(kind)) {
    return NextResponse.json({ error: "kind is required." }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  const userId = await resolveServerUserScopeId(requestedUserId);

  try {
    const item = await saveContentVaultItem({
      id: body.id,
      userId,
      kind,
      title,
      summary: body.summary,
      payload: body.payload,
      upsertKey: body.upsertKey,
    });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save content vault failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const requestedUserId = body.userId?.trim() || "";
  const id = body.id?.trim() || "";
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const userId = await resolveServerUserScopeId(requestedUserId);
  const ok = await deleteContentVaultItem(userId, id);
  if (!ok) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
