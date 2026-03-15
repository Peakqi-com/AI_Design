import { NextResponse } from "next/server";
import { isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";
import {
  generateSocialPostCopy,
  SocialPostLength,
  SocialPostTheme,
  SocialPostTone,
} from "@/lib/ai/social-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateSocialPostBody = {
  platforms?: string[];
  topic?: string;
  objective?: string;
  tone?: string;
  theme?: string;
  length?: string;
  hashtagCount?: number;
  asset?: {
    kind?: "image" | "video";
    fileName?: string;
    summary?: string;
    imageDataUrl?: string;
  };
};

const normalizeTone = (value?: string): SocialPostTone | undefined =>
  value === "professional" ||
  value === "warm" ||
  value === "friendly" ||
  value === "luxury" ||
  value === "storytelling" ||
  value === "promo"
    ? value
    : undefined;

const normalizeTheme = (value?: string): SocialPostTheme | undefined =>
  value === "marketing" || value === "daily" || value === "festival" || value === "expertise"
    ? value
    : undefined;

const normalizeLength = (value?: string): SocialPostLength | undefined =>
  value === "short" || value === "medium" || value === "long" ? value : undefined;

export async function POST(request: Request) {
  let body: GenerateSocialPostBody;
  try {
    body = (await request.json()) as GenerateSocialPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const platforms = Array.isArray(body.platforms)
    ? body.platforms.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const assetKind = body.asset?.kind;
  if (assetKind !== "image" && assetKind !== "video") {
    return NextResponse.json({ error: "asset.kind must be image or video." }, { status: 400 });
  }

  try {
    const result = await generateSocialPostCopy({
      platforms,
      topic: body.topic?.trim(),
      objective: body.objective?.trim(),
      tone: normalizeTone(body.tone?.trim()),
      theme: normalizeTheme(body.theme?.trim()),
      length: normalizeLength(body.length?.trim()),
      hashtagCount: typeof body.hashtagCount === "number" ? body.hashtagCount : undefined,
      assetKind,
      assetFileName: body.asset?.fileName?.trim(),
      assetSummary: body.asset?.summary?.trim(),
      imageDataUrl: body.asset?.imageDataUrl?.trim(),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generate social post failed.";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
