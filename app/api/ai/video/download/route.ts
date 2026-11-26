import { downloadVeoVideo, isReplicateCredentialErrorMessage } from "@/lib/ai/veo-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const videoUri = url.searchParams.get("videoUri")?.trim();
  if (!videoUri) {
    return new Response(JSON.stringify({ error: "videoUri is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const file = await downloadVeoVideo(videoUri);
    return new Response(file.buffer, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "下載影片失敗。";
    const statusCode = isReplicateCredentialErrorMessage(message) ? 503 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }
}
