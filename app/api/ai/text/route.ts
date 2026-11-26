import { NextResponse } from "next/server";
import { buildGoogleAiModelEndpoint, getGoogleAiAuthHeaders, isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

interface TextRequestBody {
  prompt?: string;
  imageDataUrl?: string; // optional image for vision/OCR tasks
  temperature?: number;
  jsonMode?: boolean;
}

export async function POST(request: Request) {
  let body: TextRequestBody;
  try {
    body = (await request.json()) as TextRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }

  try {
    const authHeaders = await getGoogleAiAuthHeaders();
    const endpoint = buildGoogleAiModelEndpoint(DEFAULT_MODEL, "generateContent");

    // Build parts: text + optional image
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
    if (body.imageDataUrl?.trim()) {
      const match = body.imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }

    const requestBody = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: body.temperature ?? 0.5,
        ...(body.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(requestBody),
    });

    const json = await response.json();
    if (!response.ok) {
      const errMsg = json?.error?.message || "Gemini text generation failed";
      throw new Error(errMsg);
    }

    // Extract text from Gemini response
    const candidates = json?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const text = candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";

    return NextResponse.json({ text, model: DEFAULT_MODEL });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI text generation failed";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
