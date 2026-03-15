import { NextResponse } from "next/server";
import { saveAttachment } from "@/lib/crm/attachments";
import { toClientAttachment } from "@/lib/crm/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json({ error: "File too large. Max 20MB." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const attachment = await saveAttachment({
    buffer: Buffer.from(arrayBuffer),
    fileName: file.name,
    mimeType: file.type || undefined,
  });

  return NextResponse.json({
    attachment: toClientAttachment(attachment),
  });
}
