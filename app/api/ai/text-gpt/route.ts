import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REPLICATE_TOKEN = (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || "").trim();
const DEFAULT_MODEL = "deepseek-ai/deepseek-v3";

interface TextAltBody {
  prompt?: string;
  temperature?: number;
  jsonMode?: boolean;
}

export async function POST(request: Request) {
  let body: TextAltBody;
  try {
    body = (await request.json()) as TextAltBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }
  if (!REPLICATE_TOKEN) {
    return NextResponse.json({ error: "REPLICATE_API_TOKEN is not configured." }, { status: 503 });
  }

  const systemPrompt = body.jsonMode
    ? "You are a helpful assistant. Always respond with valid JSON only, no markdown, no explanation."
    : "You are a helpful assistant.";

  try {
    // Create prediction via Replicate API
    const createRes = await fetch("https://api.replicate.com/v1/models/deepseek-ai/deepseek-v3/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
      },
      body: JSON.stringify({
        input: {
          prompt,
          system_prompt: systemPrompt,
          temperature: body.temperature ?? 0.5,
          max_tokens: 2048,
        },
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      throw new Error(createData?.detail || createData?.error?.message || "Replicate API error");
    }

    // Poll for result
    const predictionUrl = createData.urls?.get || `https://api.replicate.com/v1/predictions/${createData.id}`;
    let text = "";
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(predictionUrl, {
        headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
      });
      const pollData = await pollRes.json();

      if (pollData.status === "succeeded") {
        // Output can be string or array of strings
        if (typeof pollData.output === "string") {
          text = pollData.output;
        } else if (Array.isArray(pollData.output)) {
          text = pollData.output.join("");
        }
        break;
      }
      if (pollData.status === "failed" || pollData.status === "canceled") {
        throw new Error(pollData.error || "DeepSeek generation failed");
      }
    }

    if (!text) {
      throw new Error("DeepSeek generation timed out");
    }

    return NextResponse.json({ text, model: DEFAULT_MODEL });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DeepSeek generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
