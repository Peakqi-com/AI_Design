import { buildGoogleAiModelEndpoint, getGoogleAiAuthHeaders } from "@/lib/ai/google-provider";

const DEFAULT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

export interface InteriorCrmSurveyInput {
  peopleMembers: string;
  peopleHasYoungChildren: string;
  peopleHasElders: string;
  peopleParentWorkSchedule: string;
  peopleHobbies: string;
  lifeCookingHabit: string;
  lifeSleepArrangement: string;
  lifeStorageNeeds: string;
  lifeLivingRoomNeeds: string;
  timeMostUsedRoom: string;
  timeBathroomConcurrency: string;
  timeResidencyPlan: string;
  timeCleaningFrequency: string;
  siteWestSun: string;
  siteFengShuiRequirement: string;
  siteRiverOrNortheast: string;
  siteTransitNoise: string;
  objectsKeepFurniture: string;
  objectsSpecialDisplay: string;
  objectsApplianceNeeds: string;
  objectsSpecialUtilities: string;
  objectsStyle: string;
  objectsColorScheme: string;
  objectsBrandPreference: string;
  attractionNeed3dQuoteTable: string;
  attractionNeedTimeline: string;
  conversationNotes?: string;
}

export interface InteriorCrmRecommendationResult {
  summary: string;
  layoutPriorities: string[];
  materialAndColorRecommendations: string[];
  safetyAndErgonomics: string[];
  storageAndAppliancePlan: string[];
  quoteAndScheduleSuggestions: string[];
  riskAlerts: string[];
  nextInterviewQuestions: string[];
}

export interface InteriorCrmRecommendationInput {
  contact: {
    id: string;
    displayName: string;
    tags?: string[];
    status?: string;
  };
  survey: InteriorCrmSurveyInput;
  conversationSummary?: string;
}

interface GeminiPart {
  text?: string;
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

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];

const normalizeRecommendation = (value: unknown): InteriorCrmRecommendationResult | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Partial<InteriorCrmRecommendationResult>;
  const summary = typeof source.summary === "string" ? source.summary.trim() : "";
  if (!summary) {
    return null;
  }
  return {
    summary,
    layoutPriorities: toArray(source.layoutPriorities),
    materialAndColorRecommendations: toArray(source.materialAndColorRecommendations),
    safetyAndErgonomics: toArray(source.safetyAndErgonomics),
    storageAndAppliancePlan: toArray(source.storageAndAppliancePlan),
    quoteAndScheduleSuggestions: toArray(source.quoteAndScheduleSuggestions),
    riskAlerts: toArray(source.riskAlerts),
    nextInterviewQuestions: toArray(source.nextInterviewQuestions),
  };
};

const parseJsonCandidate = (text: string): InteriorCrmRecommendationResult | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced ? fenced[1] : trimmed;
  const objectLike = source.match(/\{[\s\S]*\}/);
  const candidate = objectLike ? objectLike[0] : source;
  try {
    const parsed = JSON.parse(candidate);
    return normalizeRecommendation(parsed);
  } catch {
    return null;
  }
};

const getResponseText = (body: GeminiResponse): string =>
  (body.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim();

const buildFallbackRecommendation = (input: InteriorCrmRecommendationInput): InteriorCrmRecommendationResult => {
  const survey = input.survey;
  const risks: string[] = [];
  const safety: string[] = [];
  const layout: string[] = [];
  const material: string[] = [];
  const storage: string[] = [];
  const quote: string[] = [];
  const nextQuestions: string[] = [];

  if (survey.peopleHasYoungChildren === "yes") {
    safety.push("兒童活動區採圓角、緩衝材質與防夾手五金。");
    safety.push("地坪優先止滑耐磨材，降低跌倒風險。");
  }
  if (survey.peopleHasElders === "yes") {
    safety.push("浴廁與走道加入扶手與夜間導光，降低夜間跌倒風險。");
    safety.push("預留輪椅/助行器回轉淨空，門檻盡量降至最低。");
  }
  if (survey.siteWestSun === "yes") {
    risks.push("西曬條件明顯，需優先規劃遮陽、隔熱窗簾與低輻射玻璃。");
  }
  if (survey.siteTransitNoise.trim()) {
    risks.push("臨交通噪音場域，建議在窗體與牆面加強隔音分層。");
  }
  if (/daily-cook/.test(survey.lifeCookingHabit)) {
    layout.push("餐廚區採高效率工作三角，並預留備餐平台。");
    storage.push("廚房收納應分區規劃：乾貨、鍋具、小家電、回收清潔分流。");
  }
  if (survey.lifeStorageNeeds.trim()) {
    storage.push("依收納量體規劃高頻與低頻儲物層級，避免只做外觀櫃量。");
  }
  if (survey.objectsStyle.trim() || survey.objectsColorScheme.trim()) {
    material.push(`風格以「${survey.objectsStyle || "使用者偏好"}」為主，色系建議「${survey.objectsColorScheme || "中性色基底"}」。`);
  }
  quote.push("3D 模型與施工報價建議分項：拆除、泥作、水電、木作、油漆、燈具、軟裝。");
  quote.push("工期請先標示關鍵路徑（拆除→水電→泥作→木作→油漆→安裝→驗收）與緩衝天數。");
  nextQuestions.push("是否有不可動的結構牆/管道間限制？");
  nextQuestions.push("預算上限與可接受增減幅度（%）為何？");
  nextQuestions.push("是否要分期施工以降低搬遷壓力？");

  return {
    summary: `已根據 ${input.contact.displayName} 的前訪資料建立初步提案方向：優先處理空間動線、收納量體與工期落地性，再進入材質與風格細化。`,
    layoutPriorities: layout.length > 0 ? layout : ["優先確認高使用頻率空間與家庭成員動線衝突點。"],
    materialAndColorRecommendations:
      material.length > 0
        ? material
        : ["先以中性色與耐用材質建立基底，再在軟裝與局部牆面加入風格色。"],
    safetyAndErgonomics:
      safety.length > 0
        ? safety
        : ["以常住成員身高與行走習慣設定檯面、櫃體與開關高度。"],
    storageAndAppliancePlan:
      storage.length > 0
        ? storage
        : ["先盤點現有物件與家電尺寸，再配置固定收納模組。"],
    quoteAndScheduleSuggestions: quote,
    riskAlerts:
      risks.length > 0
        ? risks
        : ["需先完成現場丈量與機電點位確認，避免設計圖與現場條件落差。"],
    nextInterviewQuestions: nextQuestions,
  };
};

const buildPrompt = (input: InteriorCrmRecommendationInput): string => {
  const contactTagText = (input.contact.tags || []).join("、");
  const conversation = (input.conversationSummary || "").trim();
  return [
    "你是室內設計公司 CRM 前期顧問，請根據問卷與客戶敘述，輸出可落地的設計提案建議。",
    "你必須使用 domain knowledge（人體工學、動線、收納、採光、隔熱、隔音、工法可行性、預算與工期）進行推理。",
    "輸出語言：繁體中文。",
    "輸出格式：JSON，禁止輸出 markdown。",
    "JSON schema：",
    '{"summary":"","layoutPriorities":[""],"materialAndColorRecommendations":[""],"safetyAndErgonomics":[""],"storageAndAppliancePlan":[""],"quoteAndScheduleSuggestions":[""],"riskAlerts":[""],"nextInterviewQuestions":[""]}',
    "",
    `客戶名稱：${input.contact.displayName}`,
    `客戶狀態：${input.contact.status || "new"}`,
    `客戶標籤：${contactTagText || "無"}`,
    "",
    "問卷資料：",
    JSON.stringify(input.survey, null, 2),
    "",
    conversation ? "近期客戶對話摘要：" : "",
    conversation || "",
    "",
    "撰寫要求：",
    "- summary 需包含可執行的整體方向（不是空泛形容）。",
    "- 每個陣列至少 3 點，內容要具體、可落地、可交付。",
    "- quoteAndScheduleSuggestions 要包含 3D 模型報價分項與工期安排建議。",
    "- riskAlerts 要指出可能踩雷點（例如西曬、噪音、機電衝突、預算超支）。",
    "- nextInterviewQuestions 要能幫設計師在下次會議縮小不確定性。",
  ]
    .filter(Boolean)
    .join("\n");
};

export async function generateInteriorCrmRecommendation(
  input: InteriorCrmRecommendationInput,
): Promise<{ recommendation: InteriorCrmRecommendationResult; model: string }> {
  const fallback = buildFallbackRecommendation(input);
  try {
    const headers = await getGoogleAiAuthHeaders();
    const endpoint = buildGoogleAiModelEndpoint(DEFAULT_MODEL, "generateContent");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(input) }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          responseMimeType: "application/json",
        },
      }),
    });
    const json = (await response.json()) as GeminiResponse;
    if (!response.ok) {
      throw new Error(json.error?.message || "Generate recommendation failed.");
    }
    const text = getResponseText(json);
    const parsed = parseJsonCandidate(text);
    if (!parsed) {
      return { recommendation: fallback, model: "fallback-template" };
    }
    return { recommendation: parsed, model: DEFAULT_MODEL };
  } catch {
    return { recommendation: fallback, model: "fallback-template" };
  }
}
