import { NextResponse } from "next/server";
import { upscaleImage } from "@/lib/ai/upscale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpscaleBody = {
  imageDataUrl?: string;
  scale?: number;
};

export async function POST(request: Request) {
  let body: UpscaleBody;
  try {
    body = (await request.json()) as UpscaleBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim();
  if (!imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required." }, { status: 400 });
  }

  try {
    const result = await upscaleImage({
      imageDataUrl,
      scale: body.scale,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "高清增強失敗。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
