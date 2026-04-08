import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client upload to Vercel Blob — bypasses the 4.5MB serverless function body limit.
 * POST /api/upload?filename=xxx.mp4
 * Body: raw file binary (not FormData)
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const filename = url.searchParams.get("filename") || `upload-${Date.now()}`;

  if (!request.body) {
    return NextResponse.json({ error: "No file body." }, { status: 400 });
  }

  try {
    const blob = await put(filename, request.body, {
      access: "public",
      addRandomSuffix: true,
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
