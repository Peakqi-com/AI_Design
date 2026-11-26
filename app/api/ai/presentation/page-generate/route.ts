import { NextResponse } from "next/server";
import { isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";
import {
  generatePresentationPage,
  GeneratePresentationPageInput,
} from "@/lib/ai/presentation-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = Partial<GeneratePresentationPageInput>;

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = (body.title || "").trim();
  const text = (body.body || "").trim();
  const pageIndex = Number.isFinite(Number(body.pageIndex)) ? Number(body.pageIndex) : 0;
  const totalPages = Number.isFinite(Number(body.totalPages)) ? Math.max(1, Number(body.totalPages)) : 1;

  if (!title || !text) {
    return NextResponse.json({ error: "title 與 body 為必填欄位。" }, { status: 400 });
  }

  try {
    const result = await generatePresentationPage({
      title,
      body: text,
      projectTitle: body.projectTitle?.toString(),
      designerName: body.designerName?.toString(),
      pageIndex,
      totalPages,
      styleLabel: body.styleLabel?.toString(),
      isFirst: Boolean(body.isFirst),
      isLast: Boolean(body.isLast),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generate presentation page failed.";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
