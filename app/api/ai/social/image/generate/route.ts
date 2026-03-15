import { NextResponse } from "next/server";
import { generateSocialImageByNanobanana } from "@/lib/ai/social-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateSocialImageBody = {
  imageDataUrl?: string;
  prompt?: string;
  style?: string;
};

export async function POST(request: Request) {
  let body: GenerateSocialImageBody;
  try {
    body = (await request.json()) as GenerateSocialImageBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim() || "";
  const prompt = body.prompt?.trim() || "";
  const style = body.style?.trim() || "";
  if (!imageDataUrl || !prompt) {
    return NextResponse.json({ error: "imageDataUrl and prompt are required." }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const result = await generateSocialImageByNanobanana({
      imageDataUrl,
      prompt,
      style,
    });
    return NextResponse.json({
      imageDataUrl: result.imageDataUrl,
      summary: result.summary,
      model: result.model,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generate social image failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
