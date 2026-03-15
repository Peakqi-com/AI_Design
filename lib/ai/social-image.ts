import {
  buildGoogleAiModelEndpoint,
  buildGoogleAiModelsListEndpoint,
  getGoogleAiAuthHeaders,
  normalizeGoogleModelName,
} from "@/lib/ai/google-provider";

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    message?: string;
  };
}

interface GeminiModelInfo {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiListModelsResponse {
  models?: GeminiModelInfo[];
  publisherModels?: GeminiModelInfo[];
}

export interface GenerateSocialImageInput {
  imageDataUrl: string;
  prompt: string;
  style?: string;
}

export interface GenerateSocialImageOutput {
  imageDataUrl: string;
  summary: string;
  model: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const DEFAULT_MODEL_CANDIDATES = [
  process.env.SOCIAL_IMAGE_MODEL || "",
  process.env.GEMINI_IMAGE_MODEL || "",
  process.env.NANO_BANANA_2_MODEL || "",
  process.env.NANO_BANANA_MODEL || "",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.0-flash-preview-image-generation",
  "nano-banana-2",
  "nano-banana",
].filter(Boolean);

let modelCandidateCache: { expiresAt: number; models: string[] } | null = null;

const dedupeModels = (models: string[]): string[] => {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const normalized = normalizeGoogleModelName((model || "").trim());
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
};

const parseDataUrl = (value: string): { mimeType: string; base64Data: string } => {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("社群圖片生成僅支援 base64 圖片資料（JPG/PNG/WebP）。");
  }
  const approxBytes = Math.floor((match[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("圖片大小超過 10MB，請先壓縮後再試。");
  }
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
};

const pickDiscoveredImageModels = (models: GeminiModelInfo[]): string[] =>
  models
    .filter((model) => {
      const methods = model.supportedGenerationMethods ?? [];
      if (!methods.includes("generateContent")) {
        return false;
      }
      const name = normalizeGoogleModelName(model.name || "").toLowerCase();
      return (
        name.includes("image") ||
        name.includes("image-generation") ||
        name.includes("nano-banana")
      );
    })
    .map((model) => normalizeGoogleModelName(model.name || ""))
    .filter(Boolean);

const discoverModelCandidates = async (authHeaders: Record<string, string>): Promise<string[]> => {
  if (modelCandidateCache && modelCandidateCache.expiresAt > Date.now()) {
    return modelCandidateCache.models;
  }

  let discovered: string[] = [];
  try {
    const response = await fetch(buildGoogleAiModelsListEndpoint(), {
      method: "GET",
      headers: authHeaders,
    });
    if (response.ok) {
      const body = (await response.json()) as GeminiListModelsResponse;
      discovered = pickDiscoveredImageModels([...(body.models || []), ...(body.publisherModels || [])]);
    }
  } catch {
    discovered = [];
  }

  const merged = dedupeModels([...discovered, ...DEFAULT_MODEL_CANDIDATES]);
  modelCandidateCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    models: merged,
  };
  return merged;
};

const buildPrompt = (input: GenerateSocialImageInput): string =>
  [
    "你是社群視覺設計師，請根據輸入圖片做高品質社群圖像生成。",
    "- 目標：產生可直接用於社群貼文素材庫的圖片。",
    input.style ? `- 風格方向：${input.style}` : "",
    `- 主題需求：${input.prompt}`,
    "- 請保留整體構圖和主體可辨識度，提升畫面完整度與吸引力。",
    "- 避免任何浮水印、文字疊圖、logo、拼貼。",
    "- 輸出：1 張圖片 + 繁中一句摘要。",
  ]
    .filter(Boolean)
    .join("\n");

const extractResult = (body: GeminiResponse): { imageDataUrl: string; summary: string } | null => {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  let imageBase64 = "";
  let imageMimeType = "image/png";
  let summary = "";
  for (const part of parts) {
    if (part.text) {
      summary = `${summary}\n${part.text}`.trim();
    }
    if (part.inlineData?.data) {
      imageBase64 = part.inlineData.data;
      imageMimeType = part.inlineData.mimeType || "image/png";
    }
  }
  if (!imageBase64) {
    return null;
  }
  return {
    imageDataUrl: `data:${imageMimeType};base64,${imageBase64}`,
    summary: summary || "已完成社群圖片生成。",
  };
};

const isRetriableModelError = (status: number, message: string): boolean =>
  status === 404 ||
  /not found|not supported|unknown model|disabled|not available|unsupported for generatecontent/i.test(
    message,
  );

export async function generateSocialImageByNanobanana(
  input: GenerateSocialImageInput,
): Promise<GenerateSocialImageOutput> {
  const authHeaders = await getGoogleAiAuthHeaders();
  const sourceImage = parseDataUrl(input.imageDataUrl);
  const modelCandidates = await discoverModelCandidates(authHeaders);
  if (modelCandidates.length === 0) {
    throw new Error("目前找不到可用的圖片生成模型，請確認 Gemini/Vertex 權限與模型開通狀態。");
  }
  let lastError = "社群圖片生成失敗";

  for (const model of modelCandidates) {
    const endpoint = buildGoogleAiModelEndpoint(model, "generateContent");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: buildPrompt(input) },
              {
                inlineData: {
                  mimeType: sourceImage.mimeType,
                  data: sourceImage.base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["Text", "Image"],
          temperature: 0.45,
          topP: 0.9,
        },
      }),
    });

    const body = (await response.json().catch(() => ({}))) as GeminiResponse;
    if (!response.ok) {
      lastError = body.error?.message || `社群圖片模型 API 錯誤（${response.status}）`;
      if (response.status === 401 || response.status === 403) {
        throw new Error(`AI 認證失敗：${lastError}`);
      }
      if (isRetriableModelError(response.status, lastError)) {
        continue;
      }
      continue;
    }
    const extracted = extractResult(body);
    if (!extracted) {
      lastError = `模型 ${model} 未回傳圖片內容。`;
      continue;
    }
    return {
      imageDataUrl: extracted.imageDataUrl,
      summary: extracted.summary,
      model,
    };
  }

  throw new Error(`${lastError}（已嘗試模型：${modelCandidates.join(", ")}）`);
}
