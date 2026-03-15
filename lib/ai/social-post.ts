import { buildGoogleAiModelEndpoint, getGoogleAiAuthHeaders } from "@/lib/ai/google-provider";

const DEFAULT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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

export interface SocialPostCopyInput {
  platforms: string[];
  topic?: string;
  objective?: string;
  tone?: SocialPostTone;
  theme?: SocialPostTheme;
  length?: SocialPostLength;
  assetKind: "image" | "video";
  assetFileName?: string;
  assetSummary?: string;
  imageDataUrl?: string;
  hashtagCount?: number;
}

export interface SocialPostCopyOutput {
  title: string;
  caption: string;
  hashtags: string[];
  model: string;
}

export type SocialPostTone =
  | "professional"
  | "warm"
  | "friendly"
  | "luxury"
  | "storytelling"
  | "promo";
export type SocialPostTheme = "marketing" | "daily" | "festival" | "expertise";
export type SocialPostLength = "short" | "medium" | "long";

const TONE_PROMPTS: Record<SocialPostTone, string> = {
  professional: "語氣專業、結構清楚、用詞精準，適合品牌官方發布。",
  warm: "語氣溫暖有陪伴感，強調共鳴、信任與情感連結。",
  friendly: "語氣活潑親切，像和朋友說話，易讀且有互動感。",
  luxury: "語氣高質感、精緻且克制，凸顯品味與價值。",
  storytelling: "以故事敘事方式鋪陳，前段引人，中段轉折，結尾收束。",
  promo: "促銷導向，明確利益點與行動呼籲，但避免過度硬推銷。",
};

const TONE_LABELS: Record<SocialPostTone, string> = {
  professional: "專業權威",
  warm: "溫暖陪伴",
  friendly: "活潑親切",
  luxury: "高質感精品",
  storytelling: "故事敘事",
  promo: "活動促銷",
};

const THEME_PROMPTS: Record<SocialPostTheme, string> = {
  marketing: "主軸放在行銷推廣，凸顯價值、差異化與轉換行動。",
  daily: "主軸放在日常貼文，營造真實感、親近感與穩定互動。",
  festival: "主軸放在節慶貼文，結合節日情境與對應需求。",
  expertise: "主軸放在專業介紹，清楚說明方法、流程或專業觀點。",
};

const THEME_LABELS: Record<SocialPostTheme, string> = {
  marketing: "行銷推廣",
  daily: "日常貼文",
  festival: "節慶貼文",
  expertise: "專業介紹",
};

const LENGTH_PROMPTS: Record<SocialPostLength, string> = {
  short: "短文：2 段內，約 80-120 字，重點直接、節奏快。",
  medium: "中長文：3 段左右，約 140-220 字，資訊與情感平衡。",
  long: "長文：4-5 段，約 260-420 字，完整鋪陳情境、價值與 CTA。",
};

const LENGTH_LABELS: Record<SocialPostLength, string> = {
  short: "精簡短文",
  medium: "標準中長文",
  long: "完整長文",
};

const resolveTone = (value?: string): SocialPostTone =>
  value === "warm" ||
  value === "friendly" ||
  value === "luxury" ||
  value === "storytelling" ||
  value === "promo"
    ? value
    : "professional";

const resolveTheme = (value?: string): SocialPostTheme =>
  value === "daily" || value === "festival" || value === "expertise" ? value : "marketing";

const resolveLength = (value?: string): SocialPostLength =>
  value === "short" || value === "long" ? value : "medium";

const parseDataUrl = (value: string): ParsedDataUrl => {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("imageDataUrl 必須為 base64 圖片資料。");
  }
  const approxBytes = Math.floor((match[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("圖片分析大小超過 8MB，請先壓縮後再試。");
  }
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
};

const normalizeTag = (value: string): string => {
  const clean = value
    .replace(/^#+/, "")
    .replace(/[^0-9A-Za-z_\u4e00-\u9fa5]/g, "")
    .trim();
  return clean ? `#${clean}` : "";
};

const dedupe = (items: string[]): string[] => Array.from(new Set(items));

const TECHNICAL_COPY_PATTERN =
  /(圖轉影|影生影|模式|運鏡|dolly|pan|orbit|比例|時長|秒|解析|模型|veo|image-?to-?video|keyframe|panorama|render|preview|9:16|16:9|1:1|4:3|素材流程|操作步驟)/i;

const compactText = (value: string): string => value.replace(/\s+/g, " ").trim();

const deriveMarketingSummary = (input: SocialPostCopyInput): string => {
  const rawSummary = compactText(input.assetSummary || "");
  const rawFileName = compactText(input.assetFileName || "").replace(/\.[a-z0-9]+$/i, "");

  const summaryCandidates = rawSummary
    .split(/[|｜·,\n，;；]+/)
    .map((part) => compactText(part))
    .filter(Boolean)
    .filter((part) => !TECHNICAL_COPY_PATTERN.test(part))
    .filter((part) => part.length >= 2);

  if (summaryCandidates.length > 0) {
    return summaryCandidates.slice(0, 2).join("、");
  }

  if (rawFileName && !TECHNICAL_COPY_PATTERN.test(rawFileName)) {
    return rawFileName;
  }

  return input.assetKind === "video" ? "社群主題展示影片" : "社群主題展示圖片";
};

const extractResponseText = (body: GeminiResponse): string => {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => part.text || "")
    .join("\n")
    .trim();
};

const parseJsonCandidate = (text: string): { title?: string; caption?: string; hashtags?: unknown } | null => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced ? fenced[1] : trimmed;

  const objectLike = source.match(/\{[\s\S]*\}/);
  const candidate = objectLike ? objectLike[0] : source;
  try {
    return JSON.parse(candidate) as { title?: string; caption?: string; hashtags?: unknown };
  } catch {
    return null;
  }
};

const buildFallback = (input: SocialPostCopyInput): SocialPostCopyOutput => {
  const tone = resolveTone(input.tone);
  const theme = resolveTheme(input.theme);
  const length = resolveLength(input.length);
  const summary = deriveMarketingSummary(input);
  const title = (input.topic?.trim() || `${input.assetKind === "video" ? "影片" : "圖片"}貼文`) + "｜可直接發布";
  const caption = [
    `【${THEME_LABELS[theme]}｜${TONE_LABELS[tone]}｜${LENGTH_LABELS[length]}】`,
    `這次主打內容聚焦在「${summary}」，我們用更貼近消費者的角度，整理出你真正在意的選擇重點。`,
    input.objective?.trim()
      ? `我們這篇希望達成：${input.objective.trim()}。`
      : "內容已整理成可直接閱讀與收藏的重點版本。",
    `撰寫方向：${THEME_PROMPTS[theme]} ${TONE_PROMPTS[tone]} ${LENGTH_PROMPTS[length]} 內容會聚焦需求、價值與行動，而非介紹技術流程。`,
    "如果你也想套用同樣做法，留言或私訊，我們可以提供完整執行建議。",
  ].join("\n\n");

  const tags = dedupe(
    [
      normalizeTag(input.topic || ""),
      "#社群貼文",
      "#內容行銷",
      input.assetKind === "video" ? "#短影音" : "#社群圖片",
      "#品牌經營",
      "#內容創作",
    ].filter(Boolean),
  ).slice(0, Math.max(5, Math.min(input.hashtagCount ?? 10, 12)));

  return {
    title,
    caption,
    hashtags: tags,
    model: "fallback-template",
  };
};

export async function generateSocialPostCopy(
  input: SocialPostCopyInput,
): Promise<SocialPostCopyOutput> {
  const hashtagCount = Math.max(5, Math.min(input.hashtagCount ?? 10, 14));
  const tone = resolveTone(input.tone);
  const theme = resolveTheme(input.theme);
  const length = resolveLength(input.length);
  const marketingSummary = deriveMarketingSummary(input);

  let authHeaders: Record<string, string> = {};
  try {
    authHeaders = await getGoogleAiAuthHeaders();
  } catch {
    return buildFallback(input);
  }

  let image: ParsedDataUrl | null = null;
  if (input.imageDataUrl?.trim()) {
    try {
      image = parseDataUrl(input.imageDataUrl);
    } catch {
      image = null;
    }
  }
  const endpoint = buildGoogleAiModelEndpoint(DEFAULT_MODEL, "generateContent");

  const prompt = [
    "你是資深社群行銷企劃，請根據素材內容直接產生『可立即發佈』的繁體中文社群貼文。",
    "核心任務：以消費者需求為中心，寫出有情境、有價值、有行動引導的行銷文案。",
    "不要給教學、不要給說明步驟、不要提到你是 AI。",
    "除非素材、檔名、主題或目標明確提及，否則不得自行假設產業情境（例如室內設計、餐飲、教育、美妝等）。",
    "嚴格禁止寫成功能演示或技術介紹，禁止出現：圖轉影、模式、運鏡、比例、秒數、解析度、模型、生成流程、示範做法。",
    "輸出必須是 JSON，格式如下：",
    '{"title":"", "caption":"", "hashtags":["#tag1","#tag2"]}',
    `目標平台：${input.platforms.join(", ") || "instagram, facebook"}`,
    `素材類型：${input.assetKind === "video" ? "影片" : "圖片"}`,
    `素材檔名：${input.assetFileName || "未命名素材"}`,
    `消費者可感知素材重點：${marketingSummary}`,
    `口吻設定：${TONE_LABELS[tone]}。方向建議：${TONE_PROMPTS[tone]}`,
    `主題方向：${THEME_LABELS[theme]}。方向建議：${THEME_PROMPTS[theme]}`,
    `貼文長度：${LENGTH_LABELS[length]}。長度要求：${LENGTH_PROMPTS[length]}`,
    input.topic?.trim() ? `貼文主題：${input.topic.trim()}` : "",
    input.objective?.trim() ? `貼文目標：${input.objective.trim()}` : "",
    `hashtags 數量：請輸出 ${hashtagCount} 個，避免重複。`,
    "caption 內容要求：",
    "- 第一段：以目標客群痛點/期待切入（例如想快速理解產品差異、想看實際使用效果）",
    "- 中段：描述使用者能得到的價值、差異化與安心感（不要講製作技術）",
    "- 結尾：明確 CTA（預約、私訊、留言、點連結）",
    "- 直接輸出完整可發佈內容，不要使用「略」、「同上」、「請自行調整」等占位文字",
    "若有圖片輸入，請以圖片呈現的情境與風格為主；若無圖片則依消費者可感知重點撰寫。",
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...(image
            ? [
                { text: "以下是本次貼文素材圖片，請根據這張圖撰寫貼文：" },
                {
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.base64Data,
                  },
                },
              ]
            : []),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.55,
      responseMimeType: "application/json",
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as GeminiResponse;
    if (!response.ok) {
      throw new Error(json.error?.message || "Gemini text generation failed");
    }

    const text = extractResponseText(json);
    const parsed = parseJsonCandidate(text);
    if (!parsed) {
      return buildFallback(input);
    }

    const title = String(parsed.title || "").trim();
    const caption = String(parsed.caption || "").trim();
    const hashtagsRaw = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((tag) => normalizeTag(String(tag || ""))).filter(Boolean)
      : [];
    const hashtags = dedupe(hashtagsRaw).slice(0, hashtagCount);

    if (!title || !caption || hashtags.length === 0) {
      return buildFallback(input);
    }

    return {
      title,
      caption,
      hashtags,
      model: DEFAULT_MODEL,
    };
  } catch {
    return buildFallback(input);
  }
}
