import { NextResponse } from "next/server";
import { isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";
import { generateInteriorRender } from "@/lib/ai/interior-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RenderBody = {
  imageDataUrl?: string;
  referenceDressImageDataUrl?: string;
  dressSpec?: string;
  lockFace?: boolean;
  preserveIdentityStrict?: boolean;
  roomType?: string;
  style?: string;
  customPrompt?: string;
  creativity?: number;
  preferredModel?: string;
};

export async function POST(request: Request) {
  let body: RenderBody;
  try {
    body = (await request.json()) as RenderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim();
  const referenceDressImageDataUrl = body.referenceDressImageDataUrl?.trim() || undefined;
  const dressSpec = body.dressSpec?.trim() || undefined;
  const lockFace = body.lockFace !== false;
  const preserveIdentityStrict =
    body.preserveIdentityStrict === true || lockFace || Boolean(referenceDressImageDataUrl);
  const roomType = body.roomType?.trim();
  const style = body.style?.trim();
  const customPrompt = body.customPrompt?.trim() || "";
  const creativity = typeof body.creativity === "number" ? body.creativity : 28;
  const preferredModel = body.preferredModel?.trim() || undefined;

  if (!imageDataUrl || !roomType || !style) {
    return NextResponse.json(
      { error: "imageDataUrl, roomType, style are required." },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await generateInteriorRender({
      imageDataUrl,
      roomType,
      style,
      referenceDressImageDataUrl,
      dressSpec,
      lockFace,
      preserveIdentityStrict,
      customPrompt,
      creativity,
      preferredModel,
    });

    return NextResponse.json({
      imageDataUrl: result.imageDataUrl,
      summary: result.summary,
      model: result.model,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 室內渲染發生未知錯誤。";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json(
      {
        error: message,
      },
      { status },
    );
  }
}
