import React, { useEffect, useMemo, useState } from "react";
import { Button } from "./Button";
import { RefreshCw, Sparkles } from "lucide-react";
import { useCredits } from "@/lib/client/use-credits";

interface ContactLite {
  id: string;
  displayName: string;
  tags?: string[];
  status?: "new" | "contacted" | "proposal" | "signed";
}

interface MessageLite {
  direction: "inbound" | "outbound";
  text?: string;
  timestamp: string;
}

interface InteriorIntakePanelProps {
  selectedContact: ContactLite | null;
  userScopeId: string;
  conversationMessages: MessageLite[];
  onCompletionChange: (completed: boolean) => void;
}

interface InteriorSurveyForm {
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
  conversationNotes: string;
}

interface InteriorAiRecommendation {
  summary: string;
  layoutPriorities: string[];
  materialAndColorRecommendations: string[];
  safetyAndErgonomics: string[];
  storageAndAppliancePlan: string[];
  quoteAndScheduleSuggestions: string[];
  riskAlerts: string[];
  nextInterviewQuestions: string[];
}

interface ContentVaultItem {
  id: string;
  upsertKey?: string;
  payload?: unknown;
  updatedAt: string;
}

interface ContentVaultListResponse {
  items?: ContentVaultItem[];
}

interface ContentVaultSaveResponse {
  item?: ContentVaultItem;
}

interface InteriorRecommendResponse {
  recommendation: InteriorAiRecommendation;
  model: string;
}

const DEFAULT_SURVEY: InteriorSurveyForm = {
  peopleMembers: "",
  peopleHasYoungChildren: "",
  peopleHasElders: "",
  peopleParentWorkSchedule: "",
  peopleHobbies: "",
  lifeCookingHabit: "",
  lifeSleepArrangement: "",
  lifeStorageNeeds: "",
  lifeLivingRoomNeeds: "",
  timeMostUsedRoom: "",
  timeBathroomConcurrency: "",
  timeResidencyPlan: "",
  timeCleaningFrequency: "",
  siteWestSun: "",
  siteFengShuiRequirement: "",
  siteRiverOrNortheast: "",
  siteTransitNoise: "",
  objectsKeepFurniture: "",
  objectsSpecialDisplay: "",
  objectsApplianceNeeds: "",
  objectsSpecialUtilities: "",
  objectsStyle: "",
  objectsColorScheme: "",
  objectsBrandPreference: "",
  attractionNeed3dQuoteTable: "",
  attractionNeedTimeline: "",
  conversationNotes: "",
};

const EMPTY_RECOMMENDATION: InteriorAiRecommendation = {
  summary: "",
  layoutPriorities: [],
  materialAndColorRecommendations: [],
  safetyAndErgonomics: [],
  storageAndAppliancePlan: [],
  quoteAndScheduleSuggestions: [],
  riskAlerts: [],
  nextInterviewQuestions: [],
};

const REQUIRED_FIELDS: Array<keyof InteriorSurveyForm> = [
  "peopleMembers",
  "peopleHasYoungChildren",
  "peopleHasElders",
  "peopleParentWorkSchedule",
  "peopleHobbies",
  "lifeCookingHabit",
  "lifeSleepArrangement",
  "lifeStorageNeeds",
  "lifeLivingRoomNeeds",
  "timeMostUsedRoom",
  "timeBathroomConcurrency",
  "timeResidencyPlan",
  "timeCleaningFrequency",
  "siteWestSun",
  "siteFengShuiRequirement",
  "siteRiverOrNortheast",
  "siteTransitNoise",
  "objectsKeepFurniture",
  "objectsSpecialDisplay",
  "objectsApplianceNeeds",
  "objectsSpecialUtilities",
  "objectsStyle",
  "objectsColorScheme",
  "objectsBrandPreference",
  "attractionNeed3dQuoteTable",
  "attractionNeedTimeline",
];

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];

const normalizeSurvey = (value: unknown): InteriorSurveyForm => {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SURVEY };
  }
  const source = value as Partial<InteriorSurveyForm>;
  const next = { ...DEFAULT_SURVEY };
  (Object.keys(DEFAULT_SURVEY) as Array<keyof InteriorSurveyForm>).forEach((key) => {
    const raw = source[key];
    next[key] = typeof raw === "string" ? raw : "";
  });
  return next;
};

const normalizeRecommendation = (value: unknown): InteriorAiRecommendation => {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_RECOMMENDATION };
  }
  const source = value as Partial<InteriorAiRecommendation>;
  return {
    summary: typeof source.summary === "string" ? source.summary.trim() : "",
    layoutPriorities: normalizeStringArray(source.layoutPriorities),
    materialAndColorRecommendations: normalizeStringArray(source.materialAndColorRecommendations),
    safetyAndErgonomics: normalizeStringArray(source.safetyAndErgonomics),
    storageAndAppliancePlan: normalizeStringArray(source.storageAndAppliancePlan),
    quoteAndScheduleSuggestions: normalizeStringArray(source.quoteAndScheduleSuggestions),
    riskAlerts: normalizeStringArray(source.riskAlerts),
    nextInterviewQuestions: normalizeStringArray(source.nextInterviewQuestions),
  };
};

const getUpsertKey = (contactId: string): string => `crm_interior_intake_${contactId}`;

const isSurveyComplete = (survey: InteriorSurveyForm): boolean =>
  REQUIRED_FIELDS.every((key) => survey[key].trim().length > 0);

const requestJson = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as T & { error?: string }) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  if (!payload) {
    throw new Error("Server returned non-JSON payload.");
  }
  return payload as T;
};

export const CrmInteriorIntakePanel: React.FC<InteriorIntakePanelProps> = ({
  selectedContact,
  userScopeId,
  conversationMessages,
  onCompletionChange,
}) => {
  const credits = useCredits();
  const [survey, setSurvey] = useState<InteriorSurveyForm>({ ...DEFAULT_SURVEY });
  const [recommendation, setRecommendation] = useState<InteriorAiRecommendation>({ ...EMPTY_RECOMMENDATION });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const intakeComplete = useMemo(() => isSurveyComplete(survey), [survey]);

  useEffect(() => {
    onCompletionChange(intakeComplete);
  }, [intakeComplete, onCompletionChange]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!selectedContact?.id || !userScopeId) {
        setSurvey({ ...DEFAULT_SURVEY });
        setRecommendation({ ...EMPTY_RECOMMENDATION });
        setUpdatedAt(null);
        setError(null);
        setNotice(null);
        return;
      }
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const payload = await requestJson<ContentVaultListResponse>(
          `/api/content/vault?userId=${encodeURIComponent(userScopeId)}&kind=general&limit=120`,
          { method: "GET" },
        );
        if (cancelled) {
          return;
        }
        const target = (payload.items || []).find((item) => item.upsertKey === getUpsertKey(selectedContact.id));
        if (!target?.payload || typeof target.payload !== "object") {
          setSurvey({ ...DEFAULT_SURVEY });
          setRecommendation({ ...EMPTY_RECOMMENDATION });
          setUpdatedAt(null);
          return;
        }
        const intakePayload = target.payload as {
          survey?: unknown;
          recommendation?: unknown;
          updatedAt?: string;
        };
        setSurvey(normalizeSurvey(intakePayload.survey));
        setRecommendation(normalizeRecommendation(intakePayload.recommendation));
        setUpdatedAt(
          typeof intakePayload.updatedAt === "string" && intakePayload.updatedAt
            ? intakePayload.updatedAt
            : target.updatedAt,
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "問卷讀取失敗");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedContact?.id, userScopeId]);

  const persistIntake = async (nextSurvey: InteriorSurveyForm, nextRecommendation: InteriorAiRecommendation) => {
    if (!selectedContact?.id || !userScopeId) {
      return;
    }
    const now = new Date().toISOString();
    const payload = await requestJson<ContentVaultSaveResponse>("/api/content/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: userScopeId,
        kind: "general",
        title: `${selectedContact.displayName}｜室內設計初訪問卷`,
        summary: `問卷狀態：${isSurveyComplete(nextSurvey) ? "已完成" : "待補齊"}`,
        upsertKey: getUpsertKey(selectedContact.id),
        payload: {
          contactId: selectedContact.id,
          survey: nextSurvey,
          recommendation: nextRecommendation,
          updatedAt: now,
        },
      }),
    });
    if (!payload.item) {
      throw new Error("問卷儲存失敗，伺服器未回傳資料。");
    }
    setUpdatedAt(now);
  };

  const handleFieldChange = (field: keyof InteriorSurveyForm, value: string) => {
    setSurvey((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveSurvey = async () => {
    if (!selectedContact) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await persistIntake(survey, recommendation);
      setNotice(intakeComplete ? "已儲存問卷，並標記為可進入提案流程。" : "已儲存問卷草稿。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "問卷儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateRecommendation = async () => {
    if (!selectedContact) {
      return;
    }
    if (!intakeComplete) {
      setError("請先完整填寫問卷，再產生 AI 推薦。");
      return;
    }
    const deduction = await credits.tryDeduct("ai-text");
    if (!deduction.ok) {
      setError(deduction.error || "點數不足");
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const conversationSummary = conversationMessages
        .filter((message) => message.direction === "inbound")
        .map((message) => {
          const text = (message.text || "").trim();
          if (!text) {
            return "";
          }
          return `[${new Date(message.timestamp).toLocaleString("zh-TW")}] ${text}`;
        })
        .filter(Boolean)
        .slice(-12)
        .join("\n");

      const payload = await requestJson<InteriorRecommendResponse>("/api/ai/crm/interior-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: {
            id: selectedContact.id,
            displayName: selectedContact.displayName,
            tags: selectedContact.tags || [],
            status: selectedContact.status || "new",
          },
          survey,
          conversationSummary,
        }),
      });

      const nextRecommendation = normalizeRecommendation(payload.recommendation);
      setRecommendation(nextRecommendation);
      await persistIntake(survey, nextRecommendation);
      setNotice(`AI 推薦已更新（模型：${payload.model}）。`);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "AI 推薦生成失敗");
    } finally {
      setGenerating(false);
    }
  };

  const renderSelect = (
    label: string,
    field: keyof InteriorSurveyForm,
    options: Array<{ label: string; value: string }>,
  ) => (
    <div>
      <label className="mb-1 block text-[11px] text-gray-500">{label}</label>
      <select
        value={survey[field]}
        onChange={(event) => handleFieldChange(field, event.target.value)}
        className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none"
      >
        <option value="">請選擇</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  const renderInput = (label: string, field: keyof InteriorSurveyForm, placeholder: string) => (
    <div>
      <label className="mb-1 block text-[11px] text-gray-500">{label}</label>
      <input
        value={survey[field]}
        onChange={(event) => handleFieldChange(field, event.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none"
      />
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-gray-700">室內設計初訪問卷（人/事/時/地/物）</p>
          <p className="text-[11px] text-gray-500">
            {intakeComplete ? "已完成，可進入溝通與提案流程" : "尚未完成，建議先填完再回覆客戶"}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            intakeComplete ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {intakeComplete ? "已完成" : "待填答"}
        </span>
      </div>

      {loading ? (
        <p className="text-xs text-gray-500">問卷讀取中...</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded border border-gray-200 bg-white p-2 space-y-2">
            <p className="text-xs font-semibold text-gray-700">人</p>
            {renderInput("1. 成員", "peopleMembers", "例如：夫妻＋1名幼童＋1位長輩")}
            {renderSelect("2. 是否有年幼者使用", "peopleHasYoungChildren", [
              { label: "有", value: "yes" },
              { label: "無", value: "no" },
            ])}
            {renderSelect("3. 是否有年長者出入", "peopleHasElders", [
              { label: "有", value: "yes" },
              { label: "無", value: "no" },
            ])}
            {renderInput("4. 父母工作性質/回家時段", "peopleParentWorkSchedule", "例如：雙薪，20:00 後到家")}
            {renderInput("5. 各成員興趣", "peopleHobbies", "例如：烘焙、閱讀、居家健身")}
          </div>

          <div className="rounded border border-gray-200 bg-white p-2 space-y-2">
            <p className="text-xs font-semibold text-gray-700">事</p>
            {renderSelect("1. 開伙頻率", "lifeCookingHabit", [
              { label: "每日開伙", value: "daily-cook" },
              { label: "每週 2-4 次", value: "weekly-cook" },
              { label: "輕食/外食為主", value: "light-food" },
            ])}
            {renderInput("2. 主臥睡眠方式", "lifeSleepArrangement", "例如：同房、分房、與幼童同睡")}
            {renderInput("3. 收納方式與量體", "lifeStorageNeeds", "例如：大量換季衣物＋雜物需隱藏收納")}
            {renderInput("4. 客廳遊樂/影音需求", "lifeLivingRoomNeeds", "例如：120 吋投影＋孩童遊戲區")}
          </div>

          <div className="rounded border border-gray-200 bg-white p-2 space-y-2">
            <p className="text-xs font-semibold text-gray-700">時</p>
            {renderInput("1. 使用頻率最高房間", "timeMostUsedRoom", "例如：客廳＋餐廚")}
            {renderInput("2. 浴廁同時使用需求", "timeBathroomConcurrency", "例如：尖峰需 2 人同時使用")}
            {renderInput("3. 預計居住時長/長遠規劃", "timeResidencyPlan", "例如：至少 10 年，預留彈性客房")}
            {renderInput("4. 一週平均打掃次數", "timeCleaningFrequency", "例如：每週 2 次深度清潔")}
          </div>

          <div className="rounded border border-gray-200 bg-white p-2 space-y-2">
            <p className="text-xs font-semibold text-gray-700">地</p>
            {renderSelect("1. 是否西曬", "siteWestSun", [
              { label: "是", value: "yes" },
              { label: "否", value: "no" },
              { label: "不確定", value: "unknown" },
            ])}
            {renderInput("2. 是否有風水方位需求", "siteFengShuiRequirement", "例如：床位避樑、財位需明確")}
            {renderInput("3. 河岸或東北向條件", "siteRiverOrNortheast", "例如：臨河岸、坐東北朝西南")}
            {renderInput("4. 周遭交通噪音條件", "siteTransitNoise", "例如：近公車幹道、捷運高架旁")}
          </div>

          <div className="rounded border border-gray-200 bg-white p-2 space-y-2">
            <p className="text-xs font-semibold text-gray-700">物</p>
            {renderInput("1. 是否保留家具", "objectsKeepFurniture", "例如：保留餐桌、沙發、主臥床架")}
            {renderInput("2. 特殊放置/展示物品", "objectsSpecialDisplay", "例如：模型展示櫃、鋼琴")}
            {renderInput("3. 家電需求", "objectsApplianceNeeds", "例如：雙門冰箱、洗脫烘、洗碗機")}
            {renderInput("4. 特殊用電/加熱/通風", "objectsSpecialUtilities", "例如：IH、全熱交換、除濕系統")}
            {renderInput("5. 風格", "objectsStyle", "例如：日式無印、現代簡約、侘寂")}
            {renderInput("6. 色系", "objectsColorScheme", "例如：奶油白＋淺木色＋灰綠")}
            {renderInput("7. 品牌偏好", "objectsBrandPreference", "例如：廚具偏好 BOSCH、櫃體偏好系統板")}
          </div>

          <div className="rounded border border-gray-200 bg-white p-2 space-y-2">
            <p className="text-xs font-semibold text-gray-700">吸引需求</p>
            {renderInput("1. 3D 模型報價需求", "attractionNeed3dQuoteTable", "例如：需要分項報價表與數量表")}
            {renderInput("2. 工期製作需求", "attractionNeedTimeline", "例如：希望 8 週內完工，先做廚衛")}
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-gray-500">補充對話紀錄（文字）</label>
            <textarea
              value={survey.conversationNotes}
              onChange={(event) => handleFieldChange("conversationNotes", event.target.value)}
              placeholder="可摘要客戶重點：痛點、堅持項目、預算彈性、不可接受事項..."
              className="h-20 w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void handleSaveSurvey()} disabled={saving || loading}>
          {saving ? "儲存中..." : "儲存問卷"}
        </Button>
        <Button
          size="sm"
          onClick={() => void handleGenerateRecommendation()}
          disabled={generating || loading || !intakeComplete}
          className="gap-1"
        >
          {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          產生 AI 設計推薦
        </Button>
        {updatedAt && <span className="text-[10px] text-gray-500">更新：{new Date(updatedAt).toLocaleString("zh-TW")}</span>}
      </div>

      {notice && <div className="rounded border border-green-200 bg-green-50 px-2 py-1.5 text-[11px] text-green-700">{notice}</div>}
      {error && <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">{error}</div>}

      {recommendation.summary && (
        <div className="rounded border border-brand-200 bg-brand-50 p-2 space-y-2">
          <p className="text-xs font-semibold text-brand-700">AI 推薦摘要</p>
          <p className="text-[11px] text-brand-800 whitespace-pre-wrap">{recommendation.summary}</p>
          <ul className="list-disc pl-4 text-[11px] text-brand-800 space-y-0.5">
            {recommendation.layoutPriorities.slice(0, 3).map((item) => (
              <li key={`layout_${item}`}>布局重點：{item}</li>
            ))}
            {recommendation.materialAndColorRecommendations.slice(0, 2).map((item) => (
              <li key={`material_${item}`}>材質色彩：{item}</li>
            ))}
            {recommendation.quoteAndScheduleSuggestions.slice(0, 2).map((item) => (
              <li key={`quote_${item}`}>報價工期：{item}</li>
            ))}
            {recommendation.riskAlerts.slice(0, 2).map((item) => (
              <li key={`risk_${item}`}>風險提醒：{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
