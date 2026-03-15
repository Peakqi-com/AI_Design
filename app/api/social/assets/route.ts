import { NextResponse } from "next/server";
import {
  getSocialAssetStorageBackend,
  listSocialAssets,
  saveSocialAsset,
  SocialAssetKind,
  SocialAssetMeta,
} from "@/lib/social/media-library";
import { resolveServerUserScopeCandidates, resolveServerUserScopeId } from "@/lib/server/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND_SET = new Set<SocialAssetKind>(["image", "video"]);
const MAX_UPLOAD_SIZE = 80 * 1024 * 1024;

const parseLimit = (value: string | null): number => {
  if (!value) {
    return 24;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 24;
  }
  return Math.max(1, Math.min(100, Math.floor(parsed)));
};

const parseMeta = (value: FormDataEntryValue | null): SocialAssetMeta => {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as SocialAssetMeta;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopes = await resolveServerUserScopeCandidates(requestedUserId);

  const kindRaw = url.searchParams.get("kind")?.trim();
  const kind = kindRaw && KIND_SET.has(kindRaw as SocialAssetKind) ? (kindRaw as SocialAssetKind) : undefined;
  const limit = parseLimit(url.searchParams.get("limit"));

  try {
    const listResults = await Promise.all(
      userScopes.map((scopeId) => listSocialAssets({ userId: scopeId, kind, limit })),
    );
    const merged = listResults
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const uniq = new Map<string, (typeof merged)[number]>();
    for (const item of merged) {
      if (!uniq.has(item.id)) {
        uniq.set(item.id, item);
      }
    }
    const items = Array.from(uniq.values()).slice(0, limit);
    return NextResponse.json({
      items,
      storageBackend: getSocialAssetStorageBackend(),
      effectiveUserScope: userScopes[0],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "List social assets failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const requestedUserId = String(formData.get("userId") || "").trim();
  const userId = await resolveServerUserScopeId(requestedUserId);

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
  }

  const kindRaw = String(formData.get("kind") || "").trim();
  let kind = kindRaw as SocialAssetKind;
  if (!KIND_SET.has(kind)) {
    kind = file.type.startsWith("video/") ? "video" : "image";
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const item = await saveSocialAsset({
      userId,
      kind,
      buffer: Buffer.from(arrayBuffer),
      fileName: file.name,
      mimeType: file.type || undefined,
      meta: parseMeta(formData.get("meta")),
    });
    return NextResponse.json({ item, storageBackend: getSocialAssetStorageBackend() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save social asset failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
