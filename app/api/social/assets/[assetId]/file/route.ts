import { NextResponse } from "next/server";
import { readSocialAssetFile } from "@/lib/social/media-library";
import { resolveServerUserScopeCandidates } from "@/lib/server/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const scopeCandidates = await resolveServerUserScopeCandidates(requestedUserId);

  let result: { buffer: Buffer; mimeType: string } | null = null;
  for (const userId of scopeCandidates) {
    result = await readSocialAssetFile({ assetId, userId });
    if (result) {
      break;
    }
  }
  if (!result) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  return new NextResponse(result.buffer, {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
