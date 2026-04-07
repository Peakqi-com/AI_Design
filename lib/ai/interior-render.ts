import {
  buildGoogleAiModelEndpoint,
  buildGoogleAiModelsListEndpoint,
  getGoogleAiAuthHeaders,
  normalizeGoogleModelName,
} from "@/lib/ai/google-provider";

const DEFAULT_MODEL_CANDIDATES = [
  process.env.NANO_BANANA_PRO_MODEL || "",
  process.env.NANO_BANANA_MODEL || "",
  process.env.GEMINI_IMAGE_MODEL || "",
  "nano-banana-pro",
  "nano-banana-2",
  "nano-banana",
  "gemini-3-pro-image-preview",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash",
].filter(Boolean);

const STRICT_IDENTITY_MODEL_CANDIDATES = [
  process.env.NANO_BANANA_PRO_MODEL || "",
  process.env.NANO_BANANA_MODEL || "",
  process.env.GEMINI_STRICT_IDENTITY_MODEL || "",
  "nano-banana-pro",
  "nano-banana-2",
  "nano-banana",
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
  sameLayout?: boolean;
  hasUnexpectedObject?: boolean;
  originalAnchorCount?: number;
  generatedAnchorCount?: number;
  structureScore?: number;
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
  const hasStyleReference = Boolean(input.referenceDressImageDataUrl);
  const strictIdentity = Boolean(input.preserveIdentityStrict);
  return [
    "你是資深室內設計視覺總監，請把輸入圖轉為高品質室內設計渲染提案圖。",
    "任務類型：影像編修（edit existing image），優先保留原始空間構圖與比例。",
    "輸入圖規則：",
    "- 輸入圖 1 = 線稿、平面示意、或現況空間圖。",
    hasStyleReference ? "- 輸入圖 2 = 參考風格/材質圖（用於輔助設計語彙）。" : "",
    "生成要求：",
    `- 空間類型：${input.roomType}`,
    `- 設計任務：${input.style}`,
    input.dressSpec ? `- 指定設計細節：${input.dressSpec}` : "",
    `- 創意度：${creativityScale}/100（越高代表可以有更多風格延展）`,
    strictIdentity
      ? "- 嚴格模式：維持原始空間主體、主要開口、樑柱與主要家具位置，不做破壞性改造。"
      : "",
    hasStyleReference
      ? "- 若有參考圖，請優先學習其材質語彙、色彩節奏、燈光層次，但不要直接抄襲構圖。"
      : "",
    "- 渲染風格必須為 photorealistic，禁止插畫、卡通、塑膠感、過度 CGI。",
    "- 保留空間尺度合理性：走道淨寬、櫃體比例、家具尺寸與視角透視需自然。",
    "- 加強可提案細節：材質紋理、接縫、陰影、反射、燈光層次與可施工性。",
    "- 優先輸出可與客戶討論的版本：兼具美感、機能、動線與收納思考。",
    input.customPrompt?.trim() ? `- 使用者補充需求：${input.customPrompt.trim()}` : "",
    "",
    "請輸出：",
    "1) 一張渲染後圖片",
    "2) 50-140 字繁體中文設計說明（動線/材質/光線/機能重點）。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildRefinePrompt = (input: RefineRequestInput): string =>
  [
    "你是室內設計視覺後製師，請針對輸入圖片做「細節修復與銳化」，不得重做空間結構。",
    input.roomType ? `- 空間類型：${input.roomType}` : "",
    input.style ? `- 設計任務：${input.style}` : "",
    input.lockFace !== false
      ? "- 結構鎖定：主要空間結構、家具大輪廓、視角構圖需與原圖一致。"
      : "",
    input.sourceIdentityImageDataUrl
      ? "- 會額外提供原始圖作為結構參考，輸出需保持相同空間骨架。"
      : "",
    "- 嚴禁新增人物、浮水印、文字框、拼貼或分鏡。",
    "- 僅提升清晰度、材質紋理、邊緣細節、光影層次。",
    "- 請降低模糊與塗抹感，特別是木紋、石材、布料、金屬、燈具與牆角收邊。",
    "- 保持原有構圖與主色調，不做大幅重新設計。",
    "- 輸出需維持寫實攝影質感，避免過銳化與 AI 假感。",
    "- 請輸出一張修復後高品質圖片，並附上簡短後製說明（繁中）。",
  ]
    .filter(Boolean)
    .join("\n");

const buildPanoramaPrompt = (input: PanoramaRequestInput): string =>
  [
    "你是室內設計視覺導演，請把輸入圖片擴展成可做短影音運鏡的超寬幅室內場景。",
    input.style ? `- 目標風格：${input.style}` : "",
    "- 保留原始空間主體與主要構圖，向左右延展連續場景資訊。",
    "- 畫面需要景深與連續性，不要變形，不要破壞空間比例。",
    "- 材質、光影、陰影與反射細節需自然，優先高細節與高解析品質。",
    input.customPrompt?.trim() ? `- 補充需求：${input.customPrompt.trim()}` : "",
    "",
    "輸出要求：",
    "1) 一張超寬幅室內設計視覺（建議 21:9）",
    "2) 繁中簡短說明（描述延展出的空間重點）",
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
            { text: "[輸入圖1] 原始空間圖（結構鎖定）" },
            {
              inlineData: {
                mimeType: subjectImage.mimeType,
                data: subjectImage.base64Data,
              },
            },
            ...referenceImages.flatMap((image, index) => [
              { text: `[輸入圖${index + 2}] 風格參考圖` },
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
    "你是嚴格的室內空間結構一致性檢查器，請比對兩張圖是否為同一空間骨架。",
    "輸入圖1：原始空間圖。輸入圖2：AI 生成結果。",
    "請檢查：",
    "1) 是否保留相同空間布局（牆面、門窗、主要家具位置）",
    "2) 是否出現不合理的新增主體（大面積錯置物件、錯誤結構）",
    "3) 關鍵錨點數量（門窗/樑柱/固定櫃）是否大致一致",
    "4) 是否有拼貼、雙畫面、明顯視角錯亂",
    "只回傳 JSON：",
    '{"sameLayout":true,"hasUnexpectedObject":false,"originalAnchorCount":6,"generatedAnchorCount":6,"structureScore":95,"issues":[""],"verdict":"pass"}',
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
            { text: "[輸入圖1] 原始空間圖" },
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
      reason: (body as GeminiErrorResponse).error?.message || "結構一致性檢查失敗",
    };
  }

  const rawText = extractTextOnly(body as GeminiSuccessResponse);
  const parsed = parseJsonCandidate<IdentityCheckJson>(rawText);
  if (!parsed) {
    return {
      pass: false,
      score: 0,
      reason: "無法解析結構一致性檢查結果",
    };
  }

  const sameLayout = parsed.sameLayout === true || parsed.samePerson === true;
  const hasUnexpectedObject = parsed.hasUnexpectedObject === true || parsed.hasExtraPerson === true;
  const originalAnchorCount =
    typeof parsed.originalAnchorCount === "number" && Number.isFinite(parsed.originalAnchorCount)
      ? Math.max(0, Math.floor(parsed.originalAnchorCount))
      : typeof parsed.originalFaceCount === "number" && Number.isFinite(parsed.originalFaceCount)
        ? Math.max(0, Math.floor(parsed.originalFaceCount))
      : 1;
  const generatedAnchorCount =
    typeof parsed.generatedAnchorCount === "number" && Number.isFinite(parsed.generatedAnchorCount)
      ? Math.max(0, Math.floor(parsed.generatedAnchorCount))
      : typeof parsed.generatedFaceCount === "number" && Number.isFinite(parsed.generatedFaceCount)
        ? Math.max(0, Math.floor(parsed.generatedFaceCount))
      : 0;
  const structureScore =
    typeof parsed.structureScore === "number" && Number.isFinite(parsed.structureScore)
      ? Math.max(0, Math.min(100, Math.round(parsed.structureScore)))
      : typeof parsed.identityScore === "number" && Number.isFinite(parsed.identityScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.identityScore)))
      : 0;

  const anchorCountMatch = generatedAnchorCount === originalAnchorCount && generatedAnchorCount > 0;
  const pass = sameLayout && !hasUnexpectedObject && anchorCountMatch && structureScore >= 90;
  if (pass) {
    return { pass: true, score: structureScore, reason: "ok" };
  }

  const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(Boolean).join("；") : "";
  return {
    pass: false,
    score: structureScore,
    reason:
      issues ||
      `sameLayout=${String(sameLayout)}, unexpectedObject=${String(hasUnexpectedObject)}, anchorCount=${generatedAnchorCount}/${originalAnchorCount}, score=${structureScore}`,
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
            `- 【重試第 ${attempt} 次】上次結果未通過結構一致性檢查：${lastReason || "結構不一致"}`,
            "- 這次必須嚴格保留同一空間骨架，不可改變主要牆面、門窗與固定櫃位置。",
            "- 若無法滿足條件，請優先保留原圖構圖，只做材質、光線與陳設優化。",
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
          "已完成室內設計渲染，請確認動線、材質與照明是否符合提案方向。",
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
          "已完成室內設計渲染（結構鎖定模式），請確認空間比例與材質一致性。",
        model: result.model,
      };
    }
    lastReason = identityCheck.reason;
  }

  const modelHint =
    "若你使用 Vertex AI，請確認模型在目前區域可用（可嘗試將 VERTEX_AI_LOCATION 設為 global）" +
    "或於 GEMINI_IMAGE_MODEL 指定你已開通的影像模型。";
  throw new Error(
    "系統已攔截本次結果（結構一致性未通過）。" +
      (lastResult ? `最後嘗試模型：${lastResult.model}。` : "") +
      (lastReason ? `原因：${lastReason}。` : "請改用更清晰的線稿/原圖並重試。") +
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
      summary: result.text || "已完成室內渲染細節修復與銳化。",
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
            `- 【重試第 ${attempt} 次】上次細節修復未通過結構一致性檢查：${lastReason || "結構不一致"}`,
            "- 本次修復只能做銳化與細節修補，不可重繪主要空間結構。",
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
        summary: result.text || "已完成細節修復與銳化（結構鎖定）。",
        model: result.model,
      };
    }
    lastReason = identityCheck.reason;
  }

  throw new Error(
    `細節修復已被攔截：結果未通過結構一致性檢查。${lastModel ? `最後模型：${lastModel}。` : ""}${lastReason ? `原因：${lastReason}` : ""}`,
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
