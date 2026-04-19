import { buildGoogleAiModelEndpoint, getGoogleAiAuthHeaders } from "@/lib/ai/google-provider";
import { MessageDirection } from "@/lib/crm/types";

const DEFAULT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const DEFAULT_BUDGET_TWD = 360_000;

export interface LineConversationMessageInput {
  text?: string;
  timestamp: string;
  direction: MessageDirection;
  messageType?: string;
}

export interface GeneratedQuotationItemDraft {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface GeneratedLineQuotationDraft {
  projectName: string;
  clientName: string;
  phase: string;
  budget: string;
  note: string;
  quotationItems: GeneratedQuotationItemDraft[];
  validUntil: string;
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

interface GenerateLineQuotationInput {
  contactDisplayName: string;
  conversationMessages: LineConversationMessageInput[];
}

const clampCurrency = (value: number): number =>
  Math.max(1_000, Math.round((Number.isFinite(value) ? value : 0) / 100) * 100);

const toDateLabel = (date: Date): string => date.toISOString().slice(0, 10);

const getResponseText = (body: GeminiResponse): string =>
  (body.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim();

const normalizeClientLabel = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "LINE 客戶";
  }
  if (/^line\s*(群組|聊天室)/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
};

const buildProjectName = (clientName: string, conversationText: string): string => {
  const inferredSpace =
    [
      { label: "客廳", pattern: /客廳/ },
      { label: "廚房", pattern: /廚房/ },
      { label: "臥室", pattern: /臥室|主臥|次臥/ },
      { label: "浴室", pattern: /浴室|衛浴|廁所/ },
      { label: "全室", pattern: /全室|整體|全屋/ },
      { label: "商空", pattern: /商空|店面|辦公室/ },
    ].find((item) => item.pattern.test(conversationText))?.label || "空間提案";
  return `${clientName}｜${inferredSpace}報價草稿`;
};

const parseBudgetFromConversation = (text: string): number => {
  const matches = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(萬|千|元)/g));
  const values = matches
    .map((match) => {
      const amount = Number(match[1]);
      const unit = match[2];
      if (!Number.isFinite(amount)) {
        return 0;
      }
      if (unit === "萬") {
        return amount * 10_000;
      }
      if (unit === "千") {
        return amount * 1_000;
      }
      return amount;
    })
    .filter((value) => value > 0);
  return values.length > 0 ? Math.max(...values) : 0;
};

const formatBudgetLabel = (budgetTwd: number): string => {
  if (budgetTwd >= 10_000) {
    const wan = Math.round((budgetTwd / 10_000) * 10) / 10;
    return `${wan}萬`;
  }
  return `${Math.round(budgetTwd)}元`;
};

const buildConversationSummary = (messages: LineConversationMessageInput[]): string =>
  messages
    .filter((message) => (message.text || "").trim())
    .slice(-12)
    .map((message) => {
      const text = (message.text || "").trim();
      const role = message.direction === "outbound" ? "我方" : "客戶";
      return `[${new Date(message.timestamp).toLocaleString("zh-TW")}] ${role}: ${text}`;
    })
    .join("\n");

const buildHeuristicItems = (conversationText: string, budgetTwd: number): GeneratedQuotationItemDraft[] => {
  const normalized = conversationText.toLowerCase();
  const templates: Array<{
    key: string;
    description: string;
    baseRatio: number;
    minPrice: number;
    keywords: string[];
  }> = [
    {
      key: "需求訪談與現場丈量",
      description: "整理 LINE 群組需求、空間丈量重點與可行性假設。",
      baseRatio: 0.08,
      minPrice: 12_000,
      keywords: ["丈量", "現場", "需求", "討論", "規劃"],
    },
    {
      key: "平面配置與設計提案",
      description: "依群組需求整理格局、動線與機能配置。",
      baseRatio: 0.12,
      minPrice: 22_000,
      keywords: ["平面", "格局", "配置", "設計", "動線"],
    },
    {
      key: "3D 渲染與材質提案",
      description: "輸出風格方向、材質板與視覺模擬草稿。",
      baseRatio: 0.1,
      minPrice: 18_000,
      keywords: ["3d", "渲染", "效果圖", "材質", "風格", "提案"],
    },
    {
      key: "工程報價整合",
      description: "拆分主要工項與費用區間，建立報價初稿。",
      baseRatio: 0.14,
      minPrice: 26_000,
      keywords: ["報價", "施工", "發包", "監工", "工期", "工程"],
    },
    {
      key: "系統櫃與收納規劃",
      description: "針對櫃體、收納量體與尺寸需求做分項估算。",
      baseRatio: 0.1,
      minPrice: 20_000,
      keywords: ["收納", "系統櫃", "櫃體", "衣櫃", "玄關櫃"],
    },
    {
      key: "水電與燈光調整",
      description: "針對插座、迴路、燈光配置與設備點位做初估。",
      baseRatio: 0.09,
      minPrice: 18_000,
      keywords: ["水電", "插座", "燈", "燈光", "開關", "迴路"],
    },
    {
      key: "木作與油漆工程",
      description: "依牆面、天花與木作造型需求估算工程成本。",
      baseRatio: 0.12,
      minPrice: 24_000,
      keywords: ["木作", "天花", "油漆", "造型牆", "電視牆"],
    },
  ];

  const matched = templates.filter((template) =>
    template.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );
  const selected = (matched.length > 0 ? matched : templates.slice(0, 4)).slice(0, 5);
  return selected.map((template, index) => ({
    name: template.key,
    description: template.description,
    quantity: 1,
    unitPrice: clampCurrency(Math.max(template.minPrice, budgetTwd * template.baseRatio + index * 1_200)),
  }));
};

const buildFallbackDraft = (
  input: GenerateLineQuotationInput,
): GeneratedLineQuotationDraft => {
  const clientName = normalizeClientLabel(input.contactDisplayName);
  const conversationText = input.conversationMessages
    .map((message) => (message.text || "").trim())
    .filter(Boolean)
    .join("\n");
  const budgetTwd = parseBudgetFromConversation(conversationText) || DEFAULT_BUDGET_TWD;
  const summaryText = buildConversationSummary(input.conversationMessages);
  const noteLines = [
    "此報價草稿由 LINE 對話自動整理，建議在送出前再次確認需求、尺寸與材料。",
    summaryText ? "" : "目前對話可用資訊有限，已用預設室內設計提案結構建立草稿。",
    summaryText ? "近期待整理對話：" : "",
    summaryText,
  ].filter(Boolean);

  return {
    projectName: buildProjectName(clientName, conversationText),
    clientName,
    phase: "LINE 群組需求整理",
    budget: formatBudgetLabel(budgetTwd),
    note: noteLines.join("\n"),
    quotationItems: buildHeuristicItems(conversationText, budgetTwd),
    validUntil: toDateLabel(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
  };
};

const normalizeDraft = (value: unknown): GeneratedLineQuotationDraft | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Partial<GeneratedLineQuotationDraft>;
  const items = Array.isArray(source.quotationItems)
    ? source.quotationItems
        .map<GeneratedQuotationItemDraft | null>((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const typed = item as Partial<GeneratedQuotationItemDraft>;
          const name = String(typed.name || "").trim();
          if (!name) {
            return null;
          }
          return {
            name,
            description: String(typed.description || "").trim(),
            quantity: Math.max(1, Number(typed.quantity) || 1),
            unitPrice: clampCurrency(Number(typed.unitPrice) || 0),
          } satisfies GeneratedQuotationItemDraft;
        })
        .filter((item): item is GeneratedQuotationItemDraft => item !== null)
    : [];

  const projectName = String(source.projectName || "").trim();
  const clientName = String(source.clientName || "").trim();
  const phase = String(source.phase || "").trim();
  const budget = String(source.budget || "").trim();
  const note = String(source.note || "").trim();
  const validUntil = String(source.validUntil || "").trim();
  if (!projectName || !clientName || items.length === 0) {
    return null;
  }
  return {
    projectName,
    clientName,
    phase: phase || "LINE 群組需求整理",
    budget: budget || "待確認",
    note,
    quotationItems: items.slice(0, 8),
    validUntil: /^\d{4}-\d{2}-\d{2}$/.test(validUntil)
      ? validUntil
      : toDateLabel(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
  };
};

const parseJsonCandidate = (text: string): GeneratedLineQuotationDraft | null => {
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
    return normalizeDraft(parsed);
  } catch {
    return null;
  }
};

const buildPrompt = (input: GenerateLineQuotationInput): string => {
  const summary = buildConversationSummary(input.conversationMessages);
  return [
    "你是室內設計公司的報價助理，請根據 LINE 群組對話整理成可直接建立 CRM 專案與報價草稿的 JSON。",
    "輸出語言：繁體中文。",
    "只能輸出 JSON，不要輸出 markdown、說明或註解。",
    "JSON schema：",
    '{"projectName":"","clientName":"","phase":"","budget":"","note":"","validUntil":"YYYY-MM-DD","quotationItems":[{"name":"","description":"","quantity":1,"unitPrice":0}]}',
    "",
    "規則：",
    "- projectName 要像『某某客戶｜全室報價草稿』。",
    "- clientName 優先使用可辨識的客戶/專案名稱，不可留空。",
    "- phase 請填一個短標題，例如『LINE 群組需求整理』或『初步報價草稿』。",
    "- budget 若對話提到預算就填，例如 80萬；沒提到就填『待確認』。",
    "- note 要摘要主要需求、假設、未確認事項與下一步。",
    "- quotationItems 至少 4 項、最多 8 項，要是室內設計/裝修可落地的分項，unitPrice 請輸出整數。",
    "- 若對話資訊不足，也要產出合理的初版報價，不可回覆空陣列。",
    "",
    `聯絡人顯示名稱：${input.contactDisplayName}`,
    "LINE 對話：",
    summary || "目前只有零碎訊息，請用室內設計報價常見分項補出初版草稿。",
  ].join("\n");
};

export async function generateLineConversationQuoteDraft(
  input: GenerateLineQuotationInput,
): Promise<{ draft: GeneratedLineQuotationDraft; model: string }> {
  const fallback = buildFallbackDraft(input);
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
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    });
    const json = (await response.json()) as GeminiResponse;
    if (!response.ok) {
      throw new Error(json.error?.message || "Generate LINE quotation draft failed.");
    }
    const parsed = parseJsonCandidate(getResponseText(json));
    if (!parsed) {
      return { draft: fallback, model: "fallback-template" };
    }
    return { draft: parsed, model: DEFAULT_MODEL };
  } catch {
    return { draft: fallback, model: "fallback-template" };
  }
}
