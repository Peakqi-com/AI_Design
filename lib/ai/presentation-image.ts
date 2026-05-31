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
  const role = input.isFirst
    ? "封面背景"
    : input.isLast
      ? "結尾感謝頁背景"
      : "內容頁背景";
  const themeHint = input.title ? `本頁主題提示（供視覺發想，請不要寫進圖裡）：${input.title}` : "";

  return [
    "你是專業視覺設計師。請為一份室內設計簡報生成 1 張「純視覺背景圖」。",
    `用途：${role}（第 ${input.pageIndex + 1} / ${input.totalPages} 頁）`,
    `風格基調：${style}`,
    themeHint,
    "",
    "🚫 嚴格禁止（絕對不可違反）：",
    "- 圖片中【絕對不可】出現任何文字、字母、數字、標點、符號、頁碼、標題、watermark、logo",
    "- 不要中文字、不要英文字、不要阿拉伯數字、不要圖騰文字、不要假字",
    "- 文字會由程式之後另外排在圖上，AI 只負責純粹的視覺背景",
    "- 任何形狀只要看起來像字就算違反，必須完全避免",
    "",
    "✅ 視覺要求：",
    "- 16:9 寬螢幕構圖（1920×1080）",
    "- 室內設計相關的抽象視覺元素（例：簡約幾何、淡雅色塊、極簡建築線條、空間意象、材質紋理）",
    "- 留白充足。**上方 1/4 與下方 1/3 區域必須留出乾淨單色或低對比區域**，這些區域之後要放文字",
    "- 視覺重心放在中央或邊角，避免把主視覺元素放在「上方標題區」與「下方內文區」",
    "- 高質感、專業設計感、適合室內設計提案",
    "- 避免雜亂、避免拼貼、避免照片寫真風（要設計感 / 插畫感 / 渲染感）",
    input.isFirst ? "- 封面：色調可較大膽、有氣勢" : input.isLast ? "- 結尾：色調可柔和、有溫度" : "- 內容頁：色調穩重專業",
    "",
    "只輸出 1 張純背景圖片，不要任何解釋。",
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
