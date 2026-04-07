import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const DEFAULT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";

interface TextGptBody {
  prompt?: string;
  imageDataUrl?: string;
  temperature?: number;
  jsonMode?: boolean;
  model?: string;
}

export async function POST(request: Request) {
  let body: TextGptBody;
  try {
    body = (await request.json()) as TextGptBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  }

  const model = body.model || DEFAULT_MODEL;

  // Build messages
  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: prompt },
  ];
  if (body.imageDataUrl?.trim()) {
    contentParts.push({
      type: "image_url",
      image_url: { url: body.imageDataUrl.trim() },
    });
  }

  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: contentParts }],
    temperature: body.temperature ?? 0.5,
  };
  if (body.jsonMode) {
    requestBody.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(json?.error?.message || "OpenAI API error");
    }

    const text = json?.choices?.[0]?.message?.content || "";
    return NextResponse.json({ text, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GPT generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
