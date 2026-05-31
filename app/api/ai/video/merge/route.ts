import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ffmpeg-static provides the binary path
let ffmpegPath: string;
try {
  ffmpegPath = require("ffmpeg-static") as string;
} catch {
  ffmpegPath = "ffmpeg";
}

const runFfmpeg = (args: string[]): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve({ stdout, stderr });
    });
  });

interface MergeBody {
  videoUrls?: string[];
}

export async function POST(request: Request) {
  let body: MergeBody;
  try {
    body = (await request.json()) as MergeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const urls = body.videoUrls?.filter((u) => typeof u === "string" && u.trim()) || [];
  if (urls.length < 2) {
    return NextResponse.json({ error: "At least 2 video URLs required." }, { status: 400 });
  }
  if (urls.length > 10) {
    return NextResponse.json({ error: "Maximum 10 videos." }, { status: 400 });
  }

  const tmpDir = path.join(os.tmpdir(), `merge-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    // 1. Download all videos to temp files
    const inputFiles: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const res = await fetch(urls[i]);
      if (!res.ok) throw new Error(`Failed to download video ${i + 1}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const filePath = path.join(tmpDir, `input_${i}.mp4`);
      await fs.writeFile(filePath, buffer);
      inputFiles.push(filePath);
    }

    // 2. Create concat list file
    const concatListPath = path.join(tmpDir, "concat.txt");
    const concatContent = inputFiles.map((f) => `file '${f}'`).join("\n");
    await fs.writeFile(concatListPath, concatContent, "utf-8");

    // 3. Run ffmpeg concat
    const outputPath = path.join(tmpDir, "merged.mp4");
    await runFfmpeg([
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-c", "copy",          // no re-encoding (fast)
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);

    // 4. Read output and return
    const mergedBuffer = await fs.readFile(outputPath);

    return new Response(mergedBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="merged-video-${Date.now()}.mp4"`,
        "Content-Length": String(mergedBuffer.length),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Video merge failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    // Cleanup temp files
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
