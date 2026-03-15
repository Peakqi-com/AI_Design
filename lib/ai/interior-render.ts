import {
  buildGoogleAiModelEndpoint,
  buildGoogleAiModelsListEndpoint,
  getGoogleAiAuthHeaders,
  normalizeGoogleModelName,
} from "@/lib/ai/google-provider";

const DEFAULT_MODEL_CANDIDATES = [
  process.env.GEMINI_IMAGE_MODEL || "",
  process.env.NANO_BANANA_MODEL || "",
  process.env.NANO_BANANA_PRO_MODEL || "",
  "gemini-3-pro-image-preview",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash",
  "nano-banana-pro",
  "nano-banana-2",
  "nano-banana",
].filter(Boolean);

const STRICT_IDENTITY_MODEL_CANDIDATES = [
  process.env.GEMINI_STRICT_IDENTITY_MODEL || "",
  process.env.NANO_BANANA_MODEL || "",
  process.env.NANO_BANANA_PRO_MODEL || "",
  "gemini-3-pro-image-preview",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash",
  "nano-banana-pro",
  "nano-banana-2",
  "nano-banana",
].filter(Boolean);

const IDENTITY_CHECK_MODEL = process.env.GEMINI_IDENTITY_CHECK_MODEL || "gemini-2.5-flash";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface RenderRequestInput {
  imageDataUrl: string;
  referenceDressImageDataUrl?: string;
  dressSpec?: string;
  lockFace?: boolean;
  preserveIdentityStrict?: boolean;
  roomType: string;
  style: string;
  customPrompt?: string;
  creativity: number;
  preferredModel?: string;
}

export interface RefineRequestInput {
  imageDataUrl: string;
  sourceIdentityImageDataUrl?: string;
  lockFace?: boolean;
  roomType?: string;
  style?: string;
  preferredModel?: string;
}

export interface PanoramaRequestInput {
  imageDataUrl: string;
  style?: string;
  customPrompt?: string;
  preferredModel?: string;
}

export interface RenderResponseOutput {
  imageDataUrl: string;
  summary: string;
  model: string;
}

interface ParsedDataUrl {
  mimeType: string;
  base64Data: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

interface GeminiSuccessResponse {
  candidates?: GeminiCandidate[];
}

interface GeminiErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface CallModelResult {
  ok: boolean;
  status: number;
  body: GeminiSuccessResponse | GeminiErrorResponse;
  errorMessage?: string;
}

interface GeminiModelInfo {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiListModelsResponse {
  models?: GeminiModelInfo[];
  publisherModels?: GeminiModelInfo[];
  nextPageToken?: string;
}

interface IdentityCheckJson {
  samePerson?: boolean;
  hasExtraPerson?: boolean;
  originalFaceCount?: number;
  generatedFaceCount?: number;
  identityScore?: number;
  issues?: string[];
  verdict?: string;
}

let modelCandidateCache: { expiresAt: number; models: string[] } | null = null;

const extractDataUrl = (imageDataUrl: string): ParsedDataUrl => {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("請上傳圖片檔案（JPG / PNG / WebP），目前只支援 base64 圖片資料。");
  }
  const [, mimeType, base64Data] = match;
  const approxBytes = Math.floor((base64Data.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("圖片大小超過 10MB，請先壓縮後再試。");
  }
  return { mimeType, base64Data };
};

const buildPrompt = (input: RenderRequestInput): string => {
  const creativityScale = Math.round(Math.min(100, Math.max(0, input.creativity)));
  const hasDressReference = Boolean(input.referenceDressImageDataUrl);
  const lockFace = input.lockFace !== false;
  const strictIdentity = Boolean(input.preserveIdentityStrict || hasDressReference || lockFace);
  return [
    "你是婚紗造型總監與婚禮視覺 AI，請根據輸入圖產生高品質 AI 禮服試穿圖。",
    "任務類型：影像編修（edit existing photo），不是重新生成人像。",
    "輸入圖規則：",
    "- 輸入圖 1 = 原始人物照（身份鎖定圖）。",
    hasDressReference ? "- 輸入圖 2 = 婚紗參考圖（必須精準套用同款）。" : "",
    "生成要求：",
    `- 婚禮情境：${input.roomType}`,
    `- 禮服風格：${input.style}`,
    input.dressSpec ? `- 指定婚紗細節：${input.dressSpec}` : "",
    `- 創意度：${creativityScale}/100（越高可更自由發揮，但需保留人物關鍵特徵）`,
    lockFace
      ? "- 必須是同一個人：嚴禁換臉、嚴禁改變五官與臉型、嚴禁改變年齡與膚色。"
      : "",
    strictIdentity
      ? "- 嚴格規則：只允許替換原人物身上的衣著；臉、髮型、身形、姿勢、鏡頭角度、背景構圖都要維持原圖。"
      : "",
    strictIdentity
      ? "- 不得重繪臉部：五官位置、臉型輪廓、眼鼻口比例、膚質與年齡感需與原圖高度一致。"
      : "",
    strictIdentity
      ? "- 禁止新增任何其他人臉、路人、伴娘、攝影師、反射人像、海報人像、相框照片。"
      : "",
    strictIdentity
      ? "- 禁止多畫面拼貼、分鏡、雙圖合成、額外照片貼圖、浮水印與文字疊圖。"
      : "",
    "- 必須保留原人物髮型、臉部辨識特徵、身形比例與原始構圖，不要改變鏡頭角度。",
    "- 僅允許替換衣著為婚紗，不可生成新的陌生人。",
    hasDressReference
      ? "- 參考婚紗圖中的領口、袖型、腰線、裙擺輪廓、蕾絲/珠飾細節必須高度一致。"
      : "",
    "- 影像風格必須是寫實攝影（photorealistic），禁止卡通、插畫、3D、塑膠肌膚質感。",
    "- 保留原始人物在照片中的比例與位置，不可改成棚拍陌生模特。",
    "- 請讓禮服材質、蕾絲細節、光影層次、配件比例自然，輸出可給新人快速決策的視覺稿。",
    "- 清晰度優先：避免模糊與塗抹感，提升服裝邊緣、紋理與飾品細節。",
    "- 請生成高品質、高細節、可直接提案的婚禮試穿視覺（接近 4K 視覺品質）。",
    input.customPrompt?.trim() ? `- 使用者補充需求：${input.customPrompt.trim()}` : "",
    "",
    "請輸出：",
    "1) 一張試穿後圖片",
    "2) 50-120字繁體中文簡短說明（版型、材質、整體婚禮氛圍）。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildRefinePrompt = (input: RefineRequestInput): string =>
  [
    "你是婚紗影像後製師，請針對輸入圖片進行『細節修復與銳化』，不要改變人物身份特徵。",
    input.roomType ? `- 婚禮情境：${input.roomType}` : "",
    input.style ? `- 禮服風格：${input.style}` : "",
    input.lockFace !== false
      ? "- 身份鎖定：臉部五官、臉型、髮型、年齡感、膚色必須與原圖一致，禁止任何換臉。"
      : "",
    input.sourceIdentityImageDataUrl
      ? "- 會額外提供原始人物照作為身份參考，輸出必須與該人物完全一致。"
      : "",
    "- 嚴禁新增人物或任何額外照片元素，維持單一主體。",
    "- 僅提升畫面清晰度、服裝紋理、邊緣細節、光影層次。",
    "- 請降低模糊與塗抹感，特別是禮服蕾絲、裙襬皺褶、飾品亮面反射。",
    "- 保持原有構圖與色調，不要更換人物臉部與身形比例。",
    "- 輸出需維持真實攝影質感，避免過度磨皮、過度銳化或 AI 繪圖感。",
    "- 請輸出一張修復後高品質圖片，並附上簡短後製說明（繁中）。",
  ]
    .filter(Boolean)
    .join("\n");

const buildPanoramaPrompt = (input: PanoramaRequestInput): string =>
  [
    "你是婚禮影像導演，請把輸入圖片擴展成可做社群短影音運鏡的超寬幅婚禮場景畫面。",
    input.style ? `- 目標禮服/視覺風格：${input.style}` : "",
    "- 保留原始主體構圖（人物與禮服），向左右延展可運鏡的場景資訊。",
    "- 畫面需要有景深與場景連續性，不要變形，不要破壞人物比例。",
    "- 材質、光影、陰影與反射細節需自然，優先高細節與高解析品質。",
    input.customPrompt?.trim() ? `- 補充需求：${input.customPrompt.trim()}` : "",
    "",
    "輸出要求：",
    "1) 一張超寬幅婚禮視覺（建議 21:9 視覺感）",
    "2) 繁中簡短說明（描述延展出的場景重點）",
  ]
    .filter(Boolean)
    .join("\n");

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

const dedupeModels = (models: string[]): string[] => {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const normalized = normalizeGoogleModelName(model.trim());
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
};

const reorderByPreferred = (models: string[], preferredModel?: string): string[] => {
  const preferred = preferredModel ? normalizeGoogleModelName(preferredModel.trim()) : "";
  if (!preferred) {
    return models;
  }
  const filtered = models.filter((model) => model !== preferred);
  return [preferred, ...filtered];
};

const discoverModelCandidates = async (
  preferredModel: string | undefined,
  authHeaders: Record<string, string>,
  strictIdentityMode: boolean,
): Promise<string[]> => {
  if (modelCandidateCache && modelCandidateCache.expiresAt > Date.now()) {
    const strictMerged = dedupeModels([
      ...STRICT_IDENTITY_MODEL_CANDIDATES,
      ...modelCandidateCache.models,
    ]);
    return reorderByPreferred(
      strictIdentityMode ? strictMerged : modelCandidateCache.models,
      preferredModel,
    );
  }

  let discovered: string[] = [];

  try {
    const response = await fetch(buildGoogleAiModelsListEndpoint(), {
      method: "GET",
      headers: authHeaders,
    });
    if (response.ok) {
      const body = (await response.json()) as GeminiListModelsResponse;
      const imageModels = pickDiscoveredImageModels([
        ...(body.models ?? []),
        ...(body.publisherModels ?? []),
      ]);
      discovered = imageModels;
    }
  } catch {
    discovered = [];
  }

  const merged = dedupeModels([...discovered, ...DEFAULT_MODEL_CANDIDATES]);
  modelCandidateCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    models: merged,
  };
  const strictMerged = dedupeModels([...STRICT_IDENTITY_MODEL_CANDIDATES, ...merged]);
  return reorderByPreferred(strictIdentityMode ? strictMerged : merged, preferredModel);
};

interface PromptGenerationInput {
  imageDataUrl: string;
  referenceImageDataUrls?: string[];
  prompt: string;
  creativity: number;
  preferredModel?: string;
  strictIdentityMode?: boolean;
}

interface PromptGenerationResult {
  imageDataUrl: string;
  text: string;
  model: string;
}

const generateImageByPrompt = async (
  input: PromptGenerationInput,
): Promise<PromptGenerationResult> => {
  const authHeaders = await getGoogleAiAuthHeaders();
  const subjectImage = extractDataUrl(input.imageDataUrl);
  const referenceImages = (input.referenceImageDataUrls ?? []).map((item) => extractDataUrl(item));
  const modelCandidates = await discoverModelCandidates(
    input.preferredModel,
    authHeaders,
    Boolean(input.strictIdentityMode),
  );

  let lastError = "AI 生成失敗。";

  for (const model of modelCandidates) {
    const result = await callGeminiModel(
      model,
      input.prompt,
      subjectImage,
      referenceImages,
      input.creativity,
      authHeaders,
      Boolean(input.strictIdentityMode),
    );

    if (!result.ok) {
      lastError = result.errorMessage || lastError;
      if (isRetriableModelError(result.status, lastError)) {
        continue;
      }
      throw new Error(lastError);
    }

    const extracted = extractTextAndImage(result.body as GeminiSuccessResponse);
    if (!extracted) {
      lastError = `模型 ${model} 沒有回傳圖片資料，請調整提示詞再試。`;
      continue;
    }

    return {
      imageDataUrl: `data:${extracted.imageMimeType};base64,${extracted.imageBase64}`,
      text: extracted.text,
      model,
    };
  }

  const accessHint = /publisher model|does not have access|not found/i.test(lastError)
    ? "。若你使用 Vertex AI，請確認模型在目前區域可用（可嘗試 VERTEX_AI_LOCATION=global），或以 GEMINI_IMAGE_MODEL/NANO_BANANA_MODEL 指定你有權限的影像模型（Nano Banana 通常對應 Gemini 2.5/3 Pro/3.1 Image）"
    : "";
  throw new Error(`${lastError}（已嘗試模型：${modelCandidates.join(", ")}）${accessHint}`);
};

const extractTextAndImage = (
  body: GeminiSuccessResponse,
): { text: string; imageMimeType: string; imageBase64: string } | null => {
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  let summaryText = "";
  let imageMimeType = "image/png";
  let imageBase64 = "";

  for (const part of parts) {
    if (part.text) {
      summaryText += `${part.text}\n`;
    }
    if (part.inlineData?.data) {
      imageMimeType = part.inlineData.mimeType || "image/png";
      imageBase64 = part.inlineData.data;
    }
  }

  if (!imageBase64) {
    return null;
  }

  return {
    text: summaryText.trim(),
    imageMimeType,
    imageBase64,
  };
};

const extractTextOnly = (body: GeminiSuccessResponse): string => {
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  return parts
    .map((part) => part.text || "")
    .join("\n")
    .trim();
};

const parseJsonCandidate = <T,>(value: string): T | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced ? fenced[1] : trimmed;
  const objectMatch = source.match(/\{[\s\S]*\}/);
  const candidate = objectMatch ? objectMatch[0] : source;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
};

const callGeminiModel = async (
  model: string,
  prompt: string,
  subjectImage: ParsedDataUrl,
  referenceImages: ParsedDataUrl[],
  creativity: number,
  authHeaders: Record<string, string>,
  strictIdentityMode: boolean,
): Promise<CallModelResult> => {
  const endpoint = buildGoogleAiModelEndpoint(model, "generateContent");

  const clampedCreativity = Math.min(100, Math.max(0, creativity));
  const realismBiasedTemperature = strictIdentityMode
    ? 0.02 + clampedCreativity * 0.0022
    : 0.08 + clampedCreativity * 0.0052;

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
            { text: prompt },
            { text: "[輸入圖1] 原始人物照（身份鎖定）" },
            {
              inlineData: {
                mimeType: subjectImage.mimeType,
                data: subjectImage.base64Data,
              },
            },
            ...referenceImages.flatMap((image, index) => [
              { text: `[輸入圖${index + 2}] 婚紗參考圖` },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.base64Data,
                },
              },
            ]),
          ],
        },
      ],
      generationConfig: {
        temperature: strictIdentityMode
          ? Math.min(0.24, Math.max(0.02, realismBiasedTemperature))
          : Math.min(0.6, Math.max(0.08, realismBiasedTemperature)),
        topP: strictIdentityMode ? 0.72 : 0.9,
        responseModalities: ["Text", "Image"],
      },
    }),
  });

  let body: GeminiSuccessResponse | GeminiErrorResponse = {};
  try {
    body = (await response.json()) as GeminiSuccessResponse | GeminiErrorResponse;
  } catch {
    body = {};
  }

  if (!response.ok) {
    const err = body as GeminiErrorResponse;
    const errorMessage = err.error?.message || `Gemini API 回傳錯誤（${response.status}）`;
    return {
      ok: false,
      status: response.status,
      body,
      errorMessage,
    };
  }

  return {
    ok: true,
    status: response.status,
    body,
  };
};

interface IdentityCheckResult {
  pass: boolean;
  score: number;
  reason: string;
}

const buildIdentityCheckPrompt = (): string =>
  [
    "你是嚴格的人臉一致性檢查器，請比對兩張圖是否為同一人。",
    "輸入圖1：原始人物照。輸入圖2：AI 生成結果。",
    "請檢查：",
    "1) 是否同一個人（臉部五官、臉型、年齡感）",
    "2) 生成圖是否新增其他人物或其他臉",
    "3) 生成圖人臉數量是否和原圖一致",
    "4) 是否有拼貼、額外照片、分鏡、雙畫面",
    "只回傳 JSON：",
    '{"samePerson":true,"hasExtraPerson":false,"originalFaceCount":1,"generatedFaceCount":1,"identityScore":95,"issues":[""],"verdict":"pass"}',
  ].join("\n");

const validateIdentityLock = async (
  authHeaders: Record<string, string>,
  originalImage: ParsedDataUrl,
  generatedImage: ParsedDataUrl,
): Promise<IdentityCheckResult> => {
  const endpoint = buildGoogleAiModelEndpoint(IDENTITY_CHECK_MODEL, "generateContent");
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
            { text: buildIdentityCheckPrompt() },
            { text: "[輸入圖1] 原始人物照" },
            {
              inlineData: {
                mimeType: originalImage.mimeType,
                data: originalImage.base64Data,
              },
            },
            { text: "[輸入圖2] AI 生成結果" },
            {
              inlineData: {
                mimeType: generatedImage.mimeType,
                data: generatedImage.base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseModalities: ["Text"],
      },
    }),
  });

  let body: GeminiSuccessResponse | GeminiErrorResponse = {};
  try {
    body = (await response.json()) as GeminiSuccessResponse | GeminiErrorResponse;
  } catch {
    body = {};
  }

  if (!response.ok) {
    return {
      pass: false,
      score: 0,
      reason: (body as GeminiErrorResponse).error?.message || "人臉一致性檢查失敗",
    };
  }

  const rawText = extractTextOnly(body as GeminiSuccessResponse);
  const parsed = parseJsonCandidate<IdentityCheckJson>(rawText);
  if (!parsed) {
    return {
      pass: false,
      score: 0,
      reason: "無法解析人臉一致性檢查結果",
    };
  }

  const samePerson = parsed.samePerson === true;
  const hasExtraPerson = parsed.hasExtraPerson === true;
  const originalFaceCount =
    typeof parsed.originalFaceCount === "number" && Number.isFinite(parsed.originalFaceCount)
      ? Math.max(0, Math.floor(parsed.originalFaceCount))
      : 1;
  const generatedFaceCount =
    typeof parsed.generatedFaceCount === "number" && Number.isFinite(parsed.generatedFaceCount)
      ? Math.max(0, Math.floor(parsed.generatedFaceCount))
      : 0;
  const identityScore =
    typeof parsed.identityScore === "number" && Number.isFinite(parsed.identityScore)
      ? Math.max(0, Math.min(100, Math.round(parsed.identityScore)))
      : 0;

  const faceCountMatch = generatedFaceCount === originalFaceCount && generatedFaceCount > 0;
  const pass = samePerson && !hasExtraPerson && faceCountMatch && identityScore >= 93;
  if (pass) {
    return { pass: true, score: identityScore, reason: "ok" };
  }

  const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(Boolean).join("；") : "";
  return {
    pass: false,
    score: identityScore,
    reason:
      issues ||
      `samePerson=${String(samePerson)}, extraPerson=${String(hasExtraPerson)}, faceCount=${generatedFaceCount}/${originalFaceCount}, score=${identityScore}`,
  };
};

const isRetriableModelError = (status: number, message: string): boolean =>
  status === 404 ||
  /not found|not supported|unknown model|disabled/i.test(message);

export async function generateInteriorRender(
  input: RenderRequestInput,
): Promise<RenderResponseOutput> {
  const prompt = buildPrompt(input);
  const strictIdentityMode = Boolean(
    input.preserveIdentityStrict || input.referenceDressImageDataUrl || input.lockFace !== false,
  );
  const authHeaders = await getGoogleAiAuthHeaders();
  const originalImage = extractDataUrl(input.imageDataUrl);
  const maxAttempts = strictIdentityMode ? 4 : 1;
  let lastResult: PromptGenerationResult | null = null;
  let lastReason = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptCreativity = strictIdentityMode
      ? Math.max(
          3,
          Math.min(
            input.creativity,
            attempt === 1 ? 12 : attempt === 2 ? 10 : attempt === 3 ? 8 : 6,
          ),
        )
      : input.creativity;
    const attemptPrompt =
      attempt === 1
        ? prompt
        : [
            prompt,
            `- 【重試第 ${attempt} 次】上次結果未通過同人臉檢查：${lastReason || "身份不一致"}`,
            "- 這次必須嚴格保留同一張臉，維持單一人物，不可新增任何其他人臉。",
            "- 若無法滿足條件，寧可保持原圖構圖只改衣著，不要變更人物。",
          ].join("\n");

    const result = await generateImageByPrompt({
      imageDataUrl: input.imageDataUrl,
      referenceImageDataUrls: input.referenceDressImageDataUrl
        ? [input.referenceDressImageDataUrl]
        : undefined,
      prompt: attemptPrompt,
      creativity: attemptCreativity,
      preferredModel: input.preferredModel,
      strictIdentityMode,
    });
    lastResult = result;

    if (!strictIdentityMode) {
      return {
        imageDataUrl: result.imageDataUrl,
        summary:
          result.text ||
          "已完成 AI 試穿生成，請確認婚紗版型、材質細節與整體人物是否自然。",
        model: result.model,
      };
    }

    const generatedImage = extractDataUrl(result.imageDataUrl);
    const identityCheck = await validateIdentityLock(authHeaders, originalImage, generatedImage);
    if (identityCheck.pass) {
      return {
        imageDataUrl: result.imageDataUrl,
        summary:
          result.text ||
          "已完成 AI 試穿生成（同人臉鎖定），請確認婚紗版型、材質細節與參考款是否一致。",
        model: result.model,
      };
    }
    lastReason = identityCheck.reason;
  }

  const modelHint =
    "若你使用 Vertex AI，請確認模型在目前區域可用（可嘗試將 VERTEX_AI_LOCATION 設為 global）" +
    "或於 GEMINI_IMAGE_MODEL 指定你已開通的影像模型。";
  throw new Error(
    "為避免換臉與多人混入，系統已攔截本次結果（人臉一致性未通過）。" +
      (lastResult ? `最後嘗試模型：${lastResult.model}。` : "") +
      (lastReason ? `原因：${lastReason}。` : "請改用更清晰正面照並重試。") +
      modelHint,
  );
}

export async function refineInteriorRender(
  input: RefineRequestInput,
): Promise<RenderResponseOutput> {
  const prompt = buildRefinePrompt(input);
  const strictIdentityMode = Boolean(input.lockFace !== false && input.sourceIdentityImageDataUrl);
  if (!strictIdentityMode) {
    const result = await generateImageByPrompt({
      imageDataUrl: input.imageDataUrl,
      prompt,
      creativity: 20,
      preferredModel: input.preferredModel,
    });
    return {
      imageDataUrl: result.imageDataUrl,
      summary: result.text || "已完成細節修復與銳化。",
      model: result.model,
    };
  }

  const authHeaders = await getGoogleAiAuthHeaders();
  const identitySource = extractDataUrl(input.sourceIdentityImageDataUrl!);
  let lastReason = "";
  let lastModel = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptPrompt =
      attempt === 1
        ? prompt
        : [
            prompt,
            `- 【重試第 ${attempt} 次】上次細節修復未通過同人臉檢查：${lastReason || "身份不一致"}`,
            "- 本次修復只能做銳化與細節修補，臉部不可重繪。",
          ].join("\n");
    const result = await generateImageByPrompt({
      imageDataUrl: input.imageDataUrl,
      referenceImageDataUrls: [input.sourceIdentityImageDataUrl!],
      prompt: attemptPrompt,
      creativity: attempt === 1 ? 8 : 5,
      preferredModel: input.preferredModel,
      strictIdentityMode: true,
    });
    lastModel = result.model;
    const generatedImage = extractDataUrl(result.imageDataUrl);
    const identityCheck = await validateIdentityLock(authHeaders, identitySource, generatedImage);
    if (identityCheck.pass) {
      return {
        imageDataUrl: result.imageDataUrl,
        summary: result.text || "已完成細節修復與銳化（同人臉鎖定）。",
        model: result.model,
      };
    }
    lastReason = identityCheck.reason;
  }

  throw new Error(
    `細節修復已被攔截：為避免換臉，結果未通過同人臉檢查。${lastModel ? `最後模型：${lastModel}。` : ""}${lastReason ? `原因：${lastReason}` : ""}`,
  );
}

export async function generatePanoramaRender(
  input: PanoramaRequestInput,
): Promise<RenderResponseOutput> {
  const prompt = buildPanoramaPrompt(input);
  const result = await generateImageByPrompt({
    imageDataUrl: input.imageDataUrl,
    prompt,
    creativity: 35,
    preferredModel: input.preferredModel,
  });

  return {
    imageDataUrl: result.imageDataUrl,
    summary: result.text || "已完成 AI 環景擴展。",
    model: result.model,
  };
}
