/**
 * Nano Banana / Gemini text-to-image — generates a full presentation slide
 * (visual + text laid out together) from a text description, no reference
 * image required. Used by the "一鍵 Nano Banana 簡報" mode.
 */

import {
  buildGoogleAiModelEndpoint,
  buildGoogleAiModelsListEndpoint,
  getGoogleAiAuthHeaders,
  normalizeGoogleModelName,
} from "@/lib/ai/google-provider";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message?: string };
}

interface GeminiModelInfo {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiListModelsResponse {
  models?: GeminiModelInfo[];
  publisherModels?: GeminiModelInfo[];
}

export interface GeneratePresentationPageInput {
  title: string;
  body: string;
  projectTitle?: string;
  designerName?: string;
  pageIndex: number;
  totalPages: number;
  styleLabel?: string;
  isFirst?: boolean;
  isLast?: boolean;
}

export interface GeneratePresentationPageOutput {
  imageDataUrl: string;
  model: string;
}

const DEFAULT_MODEL_CANDIDATES = [
  process.env.PRESENTATION_IMAGE_MODEL || "",
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

let modelCache: { expiresAt: number; models: string[] } | null = null;

const dedupeModels = (models: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of models) {
    const n = normalizeGoogleModelName((m || "").trim());
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
};

const discoverModels = async (authHeaders: Record<string, string>): Promise<string[]> => {
  if (modelCache && modelCache.expiresAt > Date.now()) return modelCache.models;
  let discovered: string[] = [];
  try {
    const resp = await fetch(buildGoogleAiModelsListEndpoint(), { method: "GET", headers: authHeaders });
    if (resp.ok) {
      const body = (await resp.json()) as GeminiListModelsResponse;
      const all = [...(body.models || []), ...(body.publisherModels || [])];
      discovered = all
        .filter((m) => {
          const methods = m.supportedGenerationMethods ?? [];
          if (!methods.includes("generateContent")) return false;
          const n = normalizeGoogleModelName(m.name || "").toLowerCase();
          return n.includes("image") || n.includes("nano-banana");
        })
        .map((m) => normalizeGoogleModelName(m.name || ""))
        .filter(Boolean);
    }
  } catch {
    discovered = [];
  }
  const merged = dedupeModels([...discovered, ...DEFAULT_MODEL_CANDIDATES]);
  modelCache = { expiresAt: Date.now() + 5 * 60 * 1000, models: merged };
  return merged;
};

const buildSlidePrompt = (input: GeneratePresentationPageInput): string => {
  const style = input.styleLabel || "現代簡約、室內設計風格、淡雅高質感色調";
  const pageMeta = `第 ${input.pageIndex + 1} / ${input.totalPages} 頁`;
  const role = input.isFirst
    ? "封面頁"
    : input.isLast
      ? "結尾感謝頁"
      : "內容頁";

  return [
    "你是專業簡報設計師，請設計 1 張 16:9 高畫質室內設計提案簡報投影片。",
    `投影片角色：${role}（${pageMeta}）`,
    `風格基調：${style}。整體美術風格簡潔、留白合宜、無雜訊。`,
    `投影片標題：「${input.title}」`,
    `投影片內文：${input.body}`,
    input.projectTitle ? `專案名稱：${input.projectTitle}` : "",
    input.designerName ? `設計師：${input.designerName}` : "",
    "",
    "排版要求：",
    "- 16:9 比例，1920×1080 解析度概念。",
    "- 上半部放標題（大字、清晰），下半部放內文（適中字級、易讀）。",
    "- 留白充足，視覺呼吸感佳。背景可為純色、漸層或低調設計元素。",
    "- 文字必須完全使用繁體中文，字體清晰可辨識，不可有亂碼或外語雜字。",
    "- 不要 watermark、不要外框、不要時間戳、不要 placeholder 文字。",
    "- 右下角可顯示頁碼「" + (input.pageIndex + 1) + "/" + input.totalPages + "」。",
    input.isFirst
      ? "- 封面頁：標題置中放大，副標題顯示設計師與專案名，視覺感官需專業大氣。"
      : input.isLast
        ? "- 結尾頁：以致謝語為主視覺，配色與封面呼應。"
        : "- 內容頁：可搭配室內設計相關的抽象視覺裝飾元素。",
    "",
    "只輸出 1 張圖片，不要文字描述。",
  ]
    .filter(Boolean)
    .join("\n");
};

const extractImage = (body: GeminiResponse): string | null => {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData?.data) {
      return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
    }
  }
  return null;
};

const isRetriableModelError = (status: number, message: string): boolean =>
  status === 404 ||
  /not found|not supported|unknown model|disabled|not available|unsupported for generatecontent/i.test(message);

export async function generatePresentationPage(
  input: GeneratePresentationPageInput,
): Promise<GeneratePresentationPageOutput> {
  const authHeaders = await getGoogleAiAuthHeaders();
  const candidates = await discoverModels(authHeaders);
  if (candidates.length === 0) {
    throw new Error("找不到可用的圖片生成模型，請確認 Gemini/Vertex 模型權限。");
  }

  let lastError = "簡報投影片生成失敗";

  for (const model of candidates) {
    const endpoint = buildGoogleAiModelEndpoint(model, "generateContent");
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildSlidePrompt(input) }] }],
        generationConfig: {
          responseModalities: ["Text", "Image"],
          temperature: 0.5,
          topP: 0.9,
        },
      }),
    });

    const body = (await resp.json().catch(() => ({}))) as GeminiResponse;
    if (!resp.ok) {
      lastError = body.error?.message || `Gemini API 錯誤（${resp.status}）`;
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(`AI 認證失敗：${lastError}`);
      }
      if (isRetriableModelError(resp.status, lastError)) continue;
      continue;
    }

    const imageUrl = extractImage(body);
    if (!imageUrl) {
      lastError = `模型 ${model} 未回傳圖片內容。`;
      continue;
    }

    return { imageDataUrl: imageUrl, model };
  }

  throw new Error(`${lastError}（已嘗試：${candidates.join(", ")}）`);
}
