import { NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/upload?pathname=xxx
 * Returns a client token for direct browser upload.
 * No handleUpload, no onUploadCompleted callback — avoids hanging.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const pathname = url.searchParams.get("pathname") || `upload-${Date.now()}`;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not configured" }, { status: 503 });
  }

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname,
    });

    return NextResponse.json({ clientToken, pathname });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

// Keep POST for backward compatibility with handleUpload
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        addRandomSuffix: true,
        maximumSizeInBytes: 100 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
