import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import {
  CrmContact,
  CrmMessage,
  ProjectAuspiciousPlan,
  ProjectDressSelectionRecord,
  ProjectNotificationTemplate,
  ProjectQuotationItem,
  ProjectQuotationMeta,
  ProjectWorkflowTask,
  CrmProject,
  CrmStore,
  LineIntegrationSettings,
  PresentationDraft,
  PricingStandardItem,
} from "@/lib/crm/types";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_STORE_KEY = process.env.CRM_STORE_REDIS_KEY || "crm:store:v1";
const FORCE_FILE_STORAGE = /^(1|true|yes)$/i.test(process.env.CRM_FORCE_FILE_STORAGE || "");
const REDIS_COOLDOWN_MS = Number(process.env.CRM_REDIS_COOLDOWN_MS || 30 * 60 * 1000);
const redis =
  !FORCE_FILE_STORAGE && REDIS_URL && REDIS_TOKEN
    ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN })
    : null;

const DATA_DIR =
  process.env.CRM_DATA_DIR ||
  (process.env.VERCEL ? "/tmp/aidesign-crm" : path.join(process.cwd(), ".data"));
const STORE_FILE = path.join(DATA_DIR, "crm-store.json");
const STORE_TMP_FILE_PREFIX = path.join(DATA_DIR, "crm-store.tmp");
const STORE_VERSION = 1;
const PROJECT_DELETE_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.PROJECT_DELETE_RETENTION_DAYS || 30),
);

let memoryFallbackStore: CrmStore | null = null;
let fileWriteQueue: Promise<void> = Promise.resolve();
let redisDisabledUntil = 0;

const nowIso = () => new Date().toISOString();
const GLOBAL_LINE_SETTINGS_SCOPE = "__global__";

const normalizeLineScope = (value?: string): string =>
  (value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

const normalizeLineSettingsRecord = (
  raw: unknown,
): Record<string, LineIntegrationSettings> => {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  const mapped = entries
    .map(([scope, settings]) => {
      const normalizedScope = normalizeLineScope(scope);
      if (!normalizedScope || !settings || typeof settings !== "object") {
        return null;
      }
      const item = settings as Partial<LineIntegrationSettings>;
      if (!item.channelId || !item.channelAccessToken || !item.channelSecret) {
        return null;
      }
      return [
        normalizedScope,
        {
          enabled: item.enabled !== false,
          channelId: String(item.channelId).trim(),
          channelAccessToken: String(item.channelAccessToken).trim(),
          channelSecret: String(item.channelSecret).trim(),
          updatedAt: String(item.updatedAt || nowIso()),
          lastWebhookAt: item.lastWebhookAt?.trim(),
          lastWebhookEventCount: Number(item.lastWebhookEventCount || 0),
          lastWebhookProcessedCount: Number(item.lastWebhookProcessedCount || 0),
          lastWebhookFailedCount: Number(item.lastWebhookFailedCount || 0),
          lastWebhookError: item.lastWebhookError || null,
        } as LineIntegrationSettings,
      ] as const;
    })
    .filter((entry): entry is readonly [string, LineIntegrationSettings] => Boolean(entry));
  return Object.fromEntries(mapped);
};

const computeProjectDeletePurgeAt = (baseDate: Date): string => {
  const next = new Date(baseDate.getTime());
  next.setDate(next.getDate() + PROJECT_DELETE_RETENTION_DAYS);
  return next.toISOString();
};

const isProjectDeleteExpired = (project: CrmProject, now: Date): boolean => {
  if (!project.deletedAt) {
    return false;
  }
  const purgeRef = project.deletePurgeAt || project.deletedAt;
  const purgeTime = new Date(purgeRef).getTime();
  if (Number.isNaN(purgeTime)) {
    return false;
  }
  return purgeTime <= now.getTime();
};

const purgeExpiredDeletedProjects = (store: CrmStore): boolean => {
  const now = new Date();
  const before = store.projects.length;
  store.projects = store.projects.filter((project) => !isProjectDeleteExpired(project, now));
  return before !== store.projects.length;
};

const createDefaultStore = (): CrmStore => ({
  version: STORE_VERSION,
  lineSettings: null,
  lineSettingsByUser: {},
  contacts: [],
  messages: [],
  projects: [],
  presentations: [],
  pricingByUser: {},
});

const cloneStore = (store: CrmStore): CrmStore => structuredClone(store);

const isReadonlyFsError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return /EROFS|EACCES|EPERM/i.test(error.message);
};

const isJsonCorruptionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error instanceof SyntaxError ||
    /unexpected end of json input|unexpected token .* in json|json/i.test(error.message.toLowerCase())
  );
};

const isNodeErrorCode = (error: unknown, code: string): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      (error as { code: string }).code.toUpperCase() === code.toUpperCase(),
  );

const isRetriableFileWriteError = (error: unknown): boolean =>
  ["ENOENT", "EEXIST", "EBUSY", "EPERM"].some((code) => isNodeErrorCode(error, code));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRedisQuotaError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /max requests limit exceeded|err max requests limit exceeded|too many requests/i.test(
    error.message.toLowerCase(),
  );
};

const handleRedisFailure = (error: unknown): void => {
  if (!isRedisQuotaError(error)) {
    return;
  }
  redisDisabledUntil = Date.now() + Math.max(60_000, REDIS_COOLDOWN_MS);
};

const canUseRedis = (): boolean => Boolean(redis) && Date.now() >= redisDisabledUntil;

const normalizeStore = (raw: unknown): CrmStore => {
  if (!raw || typeof raw !== "object") {
    return createDefaultStore();
  }

  const maybe = raw as Partial<CrmStore>;
  const normalizedLineSettingsByUser = normalizeLineSettingsRecord(maybe.lineSettingsByUser);
  const normalizedLegacyLineSettings =
    maybe.lineSettings &&
    typeof maybe.lineSettings === "object" &&
    (maybe.lineSettings as LineIntegrationSettings).channelId &&
    (maybe.lineSettings as LineIntegrationSettings).channelAccessToken &&
    (maybe.lineSettings as LineIntegrationSettings).channelSecret
      ? (maybe.lineSettings as LineIntegrationSettings)
      : null;
  if (normalizedLegacyLineSettings && !normalizedLineSettingsByUser[GLOBAL_LINE_SETTINGS_SCOPE]) {
    normalizedLineSettingsByUser[GLOBAL_LINE_SETTINGS_SCOPE] = {
      ...normalizedLegacyLineSettings,
      enabled: normalizedLegacyLineSettings.enabled !== false,
      updatedAt: normalizedLegacyLineSettings.updatedAt || nowIso(),
      lastWebhookEventCount: normalizedLegacyLineSettings.lastWebhookEventCount ?? 0,
      lastWebhookProcessedCount: normalizedLegacyLineSettings.lastWebhookProcessedCount ?? 0,
      lastWebhookFailedCount: normalizedLegacyLineSettings.lastWebhookFailedCount ?? 0,
      lastWebhookError: normalizedLegacyLineSettings.lastWebhookError ?? null,
    };
  }
  const normalizedProjects = Array.isArray(maybe.projects)
    ? maybe.projects.map((project) => {
        const item = project as CrmProject;
        const filedAt = item.filedAt?.trim() || undefined;
        const deletedAt = item.deletedAt?.trim() || undefined;
        return {
          ...item,
        dressSelectionRecords: normalizeDressSelectionRecords(item.dressSelectionRecords),
          filedAt,
          deletedAt,
          deletePurgeAt: item.deletePurgeAt?.trim() || (deletedAt ? computeProjectDeletePurgeAt(new Date(deletedAt)) : undefined),
        } as CrmProject;
      })
    : [];
  return {
    version: STORE_VERSION,
    lineSettings: normalizedLineSettingsByUser[GLOBAL_LINE_SETTINGS_SCOPE] || normalizedLegacyLineSettings,
    lineSettingsByUser: normalizedLineSettingsByUser,
    contacts: Array.isArray(maybe.contacts) ? maybe.contacts : [],
    messages: Array.isArray(maybe.messages) ? maybe.messages : [],
    projects: normalizedProjects,
    presentations: Array.isArray(maybe.presentations) ? maybe.presentations : [],
    pricingByUser:
      maybe.pricingByUser && typeof maybe.pricingByUser === "object" ? maybe.pricingByUser : {},
  };
};

const getDefaultProjectCover = (): string =>
  "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1200";

const DEFAULT_NOTIFICATION_TEMPLATES: ProjectNotificationTemplate[] = [
  {
    id: "default_timeline",
    name: "流程提醒",
    content:
      "提醒您：{projectName} 的「{taskTitle}」將在 {taskDateTime} 開始，負責人：{taskOwner}。如需調整請盡快回覆。",
  },
  {
    id: "default_preparation",
    name: "行前準備提醒",
    content:
      "您好，{projectName} 即將進行「{taskTitle}」（{taskDateTime}）。請提前確認圖面、材質樣板與聯絡窗口，謝謝！",
  },
  {
    id: "default_followup",
    name: "追蹤確認提醒",
    content:
      "溫馨提醒：{projectName} 的「{taskTitle}」預計於 {taskDateTime} 執行，若有變更請回覆此訊息，我們會即時協助。",
  },
];

const createSampleProject = (): CrmProject => {
  const now = nowIso();
  return {
    id: createId("project"),
    name: "範例｜老屋翻新 + 全室整合",
    clientName: "範例客戶",
    status: "active",
    phase: "需求訪談",
    budget: "68萬",
    coverImageUrl: getDefaultProjectCover(),
    note: "這是一筆範例資料。你可以在「新增室內設計專案」建立自己的案件並同步註記到 CRM。",
    quotationItems: [
      { id: createId("quote"), name: "室內設計規劃服務費", quantity: 1, unitPrice: 68000 },
      { id: createId("quote"), name: "施工現場協調執行", quantity: 1, unitPrice: 18000 },
    ],
    workflowTasks: [
      {
        id: createId("task"),
        date: new Date().toISOString().slice(0, 10),
        time: "09:00",
        title: "現況丈量與需求確認開始",
        detail: "丈量、拍照與需求盤點",
        owner: "專案經理",
        done: false,
        reminderMinutesBefore: 120,
        templateId: "default_timeline",
      },
      {
        id: createId("task"),
        date: new Date().toISOString().slice(0, 10),
        time: "11:00",
        title: "平面配置與動線初稿",
        detail: "確認收納量體與機能分區",
        owner: "設計師",
        done: false,
        reminderMinutesBefore: 180,
        templateId: "default_preparation",
      },
      {
        id: createId("task"),
        date: new Date().toISOString().slice(0, 10),
        time: "17:30",
        title: "材質與燈光提案會議",
        detail: "確認樣板、預算與施工節點",
        owner: "工務監工",
        done: false,
        reminderMinutesBefore: 90,
        templateId: "default_followup",
      },
    ],
    quotationMeta: {
      quoteNo: `Q-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-001`,
      status: "draft",
      updatedAt: now,
      note: "可在報價系統編輯草稿後，儲存回專案。",
    },
    notificationTemplates: DEFAULT_NOTIFICATION_TEMPLATES,
    notificationEmail: "",
    dressSelectionRecords: [
      {
        id: createId("dress"),
        dressName: "北歐木質客廳渲染",
        dressSpec: "暖木地坪、淺灰牆面、間接照明與電視牆收納",
        sourceLabel: "預設渲染模板",
        referenceImageUrl:
          "https://images.unsplash.com/photo-1617098907765-9f6d0f4d3f67?auto=format&fit=crop&q=80&w=900",
        generatedImageUrl:
          "https://images.unsplash.com/photo-1616594039964-3b2f2f996d67?auto=format&fit=crop&q=80&w=900",
        summary: "主體空間比例與材質語彙已套用至渲染場景示意。",
        model: "Gemini 3 Pro Image",
        createdAt: now,
        updatedAt: now,
      },
    ],
    auspiciousPlan: {
      ceremonyDate: "",
      preferredWindow: "afternoon",
      recommendedStartTime: "11:30",
      recommendations: ["主工項可安排在 11:30-12:00 進場，便於工班銜接。"],
      generatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeQuotationItems = (items?: ProjectQuotationItem[]): ProjectQuotationItem[] => {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items
    .map((item) => ({
      id: item.id?.trim() || createId("quote"),
      name: item.name?.trim() || "未命名項目",
      description: item.description?.trim() || "",
      unit: item.unit?.trim() || "式",
      quantity: Number.isFinite(item.quantity) ? Math.max(0, Number(item.quantity)) : 0,
      unitPrice: Number.isFinite(item.unitPrice) ? Math.max(0, Number(item.unitPrice)) : 0,
    }))
    .slice(0, 200);
};

const normalizeQuotationMeta = (meta?: ProjectQuotationMeta): ProjectQuotationMeta | undefined => {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const status =
    meta.status === "sent" || meta.status === "accepted" || meta.status === "draft"
      ? meta.status
      : "draft";
  return {
    quoteNo: meta.quoteNo?.trim() || "",
    validUntil: meta.validUntil?.trim() || "",
    status,
    note: meta.note?.trim() || "",
    updatedAt: meta.updatedAt?.trim() || nowIso(),
  };
};

const normalizeNotificationTemplates = (
  templates?: ProjectNotificationTemplate[],
): ProjectNotificationTemplate[] => {
  if (!Array.isArray(templates) || templates.length === 0) {
    return structuredClone(DEFAULT_NOTIFICATION_TEMPLATES);
  }
  const normalized = templates
    .map((item, index) => ({
      id: item.id?.trim() || `custom_template_${index + 1}`,
      name: item.name?.trim() || `提醒模板 ${index + 1}`,
      content: item.content?.trim() || "",
    }))
    .filter((item) => item.content.length > 0)
    .slice(0, 20);
  return normalized.length > 0 ? normalized : structuredClone(DEFAULT_NOTIFICATION_TEMPLATES);
};

const normalizeWorkflowTasks = (items?: ProjectWorkflowTask[]): ProjectWorkflowTask[] => {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items
    .map((item) => ({
      id: item.id?.trim() || createId("task"),
      date: item.date?.trim() || "",
      time: item.time?.trim() || "",
      title: item.title?.trim() || "未命名流程",
      detail: item.detail?.trim() || "",
      owner: item.owner?.trim() || "",
      done: Boolean(item.done),
      isCustom: Boolean(item.isCustom),
      reminderMinutesBefore: Number.isFinite(item.reminderMinutesBefore)
        ? Math.max(0, Math.min(60 * 24 * 30, Number(item.reminderMinutesBefore)))
        : 0,
      templateId: item.templateId?.trim() || "",
      lastReminderSentAt: item.lastReminderSentAt?.trim() || "",
      lastReminderFor: item.lastReminderFor?.trim() || "",
    }))
    .slice(0, 300);
};

const normalizeAuspiciousPlan = (plan?: ProjectAuspiciousPlan): ProjectAuspiciousPlan | undefined => {
  if (!plan || typeof plan !== "object") {
    return undefined;
  }
  const preferredWindow =
    plan.preferredWindow === "morning" || plan.preferredWindow === "afternoon" || plan.preferredWindow === "evening"
      ? plan.preferredWindow
      : "afternoon";
  return {
    ceremonyDate: plan.ceremonyDate?.trim() || "",
    preferredWindow,
    recommendedStartTime: plan.recommendedStartTime?.trim() || "",
    recommendations: Array.isArray(plan.recommendations)
      ? plan.recommendations.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
      : [],
    generatedAt: plan.generatedAt?.trim() || nowIso(),
  };
};

const normalizeDressSelectionRecords = (
  items?: ProjectDressSelectionRecord[],
): ProjectDressSelectionRecord[] => {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items
    .map((item) => ({
      id: item.id?.trim() || createId("dress"),
      dressName: item.dressName?.trim() || "未命名渲染紀錄",
      dressSpec: item.dressSpec?.trim() || "",
      sourceLabel: item.sourceLabel?.trim() || "",
      referenceAssetId: item.referenceAssetId?.trim() || "",
      referenceImageUrl: item.referenceImageUrl?.trim() || "",
      generatedImageUrl: item.generatedImageUrl?.trim() || "",
      summary: item.summary?.trim() || "",
      model: item.model?.trim() || "",
      note: item.note?.trim() || "",
      createdAt: item.createdAt?.trim() || nowIso(),
      updatedAt: item.updatedAt?.trim() || nowIso(),
    }))
    .slice(0, 300);
};

export const getStorageBackend = (): "redis" | "file" => (canUseRedis() ? "redis" : "file");

async function readStoreFromRedis(): Promise<CrmStore> {
  if (!redis) {
    return createDefaultStore();
  }
  const raw = await redis.get<CrmStore>(REDIS_STORE_KEY);
  return normalizeStore(raw);
}

async function writeStoreToRedis(store: CrmStore): Promise<void> {
  if (!redis) {
    return;
  }
  await redis.set(REDIS_STORE_KEY, store);
}

async function readStoreFromFile(): Promise<CrmStore> {
  try {
    const data = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(data);
    return normalizeStore(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      const fresh = createDefaultStore();
      try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(STORE_FILE, JSON.stringify(fresh, null, 2), "utf8");
      } catch (writeError) {
        if (!isReadonlyFsError(writeError)) {
          throw writeError;
        }
      }
      return fresh;
    }

    if (isReadonlyFsError(error) && memoryFallbackStore) {
      return cloneStore(memoryFallbackStore);
    }

    if (isJsonCorruptionError(error)) {
      if (memoryFallbackStore) {
        return cloneStore(memoryFallbackStore);
      }
      return createDefaultStore();
    }

    if (isReadonlyFsError(error)) {
      return createDefaultStore();
    }

    throw error;
  }
}

async function writeStoreToFile(store: CrmStore): Promise<void> {
  const serialized = JSON.stringify(store, null, 2);
  const tmpFile = `${STORE_TMP_FILE_PREFIX}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.json`;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Write-then-rename to reduce chances of readers seeing partial JSON.
    await fs.writeFile(tmpFile, serialized, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(tmpFile, STORE_FILE);
        break;
      } catch (error) {
        if (!isRetriableFileWriteError(error) || attempt >= 2) {
          throw error;
        }
        await sleep(20 * (attempt + 1));
      }
    }
    memoryFallbackStore = cloneStore(store);
  } catch (error) {
    if (isReadonlyFsError(error)) {
      memoryFallbackStore = cloneStore(store);
      return;
    }
    throw error;
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
}

const enqueueFileWrite = async (store: CrmStore): Promise<void> => {
  const run = async () => {
    await writeStoreToFile(store);
  };
  const pending = fileWriteQueue.then(run, run);
  fileWriteQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  await pending;
};

const mutateStore = async <T>(mutator: (store: CrmStore) => T | Promise<T>): Promise<T> => {
  if (canUseRedis()) {
    const store = await getStore();
    const result = await mutator(store);
    await saveStore(store);
    return result;
  }

  let result!: T;
  const run = async () => {
    const base = memoryFallbackStore ? cloneStore(memoryFallbackStore) : await readStoreFromFile();
    result = await mutator(base);
    await writeStoreToFile(base);
  };
  const pending = fileWriteQueue.then(run, run);
  fileWriteQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  await pending;
  return result;
};

export async function getStore(): Promise<CrmStore> {
  if (canUseRedis()) {
    try {
      const store = await readStoreFromRedis();
      memoryFallbackStore = cloneStore(store);
      return store;
    } catch (error) {
      handleRedisFailure(error);
      if (memoryFallbackStore) {
        return cloneStore(memoryFallbackStore);
      }
    }
  }

  await fileWriteQueue;
  if (memoryFallbackStore) {
    return cloneStore(memoryFallbackStore);
  }
  const store = await readStoreFromFile();
  memoryFallbackStore = cloneStore(store);
  return store;
}

async function saveStore(store: CrmStore): Promise<void> {
  if (canUseRedis()) {
    try {
      await writeStoreToRedis(store);
      memoryFallbackStore = cloneStore(store);
      return;
    } catch (error) {
      handleRedisFailure(error);
    }
  }
  await enqueueFileWrite(store);
}

const buildMessagePreview = (message: CrmMessage): string => {
  if (message.text?.trim()) {
    return message.text.trim();
  }
  if (message.messageType === "sticker") {
    return "[貼圖]";
  }
  if (message.messageType === "location") {
    return "[位置]";
  }
  if (message.attachment) {
    const fileName = message.attachment.name ? ` ${message.attachment.name}` : "";
    switch (message.attachment.type) {
      case "image":
        return `[圖片]${fileName}`;
      case "audio":
        return `[語音]${fileName}`;
      case "video":
        return `[影片]${fileName}`;
      case "file":
      default:
        return `[檔案]${fileName}`;
    }
  }
  return "[訊息]";
};

export const createId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;

const resolveLineScopeKey = (userScopeId?: string): string =>
  normalizeLineScope(userScopeId) || GLOBAL_LINE_SETTINGS_SCOPE;

const cloneLineSettings = (
  settings: LineIntegrationSettings | null | undefined,
): LineIntegrationSettings | null =>
  settings
    ? {
        ...settings,
        lastWebhookEventCount: settings.lastWebhookEventCount ?? 0,
        lastWebhookProcessedCount: settings.lastWebhookProcessedCount ?? 0,
        lastWebhookFailedCount: settings.lastWebhookFailedCount ?? 0,
        lastWebhookError: settings.lastWebhookError ?? null,
      }
    : null;

export async function getLineSettings(userScopeId?: string): Promise<LineIntegrationSettings | null> {
  const store = await getStore();
  const scopeKey = resolveLineScopeKey(userScopeId);
  const map = store.lineSettingsByUser || {};
  const scoped = map[scopeKey];
  if (scoped) {
    return cloneLineSettings(scoped);
  }
  if (scopeKey !== GLOBAL_LINE_SETTINGS_SCOPE && map[GLOBAL_LINE_SETTINGS_SCOPE]) {
    return cloneLineSettings(map[GLOBAL_LINE_SETTINGS_SCOPE]);
  }
  return cloneLineSettings(store.lineSettings);
}

export async function listLineSettingsByScope(): Promise<
  Array<{ userScopeId: string; settings: LineIntegrationSettings }>
> {
  const store = await getStore();
  const map = store.lineSettingsByUser || {};
  const entries = Object.entries(map)
    .filter(([, settings]) => Boolean(settings?.channelId && settings?.channelAccessToken && settings?.channelSecret))
    .map(([userScopeId, settings]) => ({
      userScopeId,
      settings: cloneLineSettings(settings)!,
    }));

  if (entries.length === 0 && store.lineSettings) {
    return [
      {
        userScopeId: GLOBAL_LINE_SETTINGS_SCOPE,
        settings: cloneLineSettings(store.lineSettings)!,
      },
    ];
  }
  return entries;
}

export async function saveLineSettings(
  settings: LineIntegrationSettings,
  userScopeId?: string,
): Promise<LineIntegrationSettings> {
  const scopeKey = resolveLineScopeKey(userScopeId);
  const nextSettings: LineIntegrationSettings = {
    ...settings,
    channelId: settings.channelId.trim(),
    channelAccessToken: settings.channelAccessToken.trim(),
    channelSecret: settings.channelSecret.trim(),
    updatedAt: settings.updatedAt || nowIso(),
    lastWebhookEventCount: settings.lastWebhookEventCount ?? 0,
    lastWebhookProcessedCount: settings.lastWebhookProcessedCount ?? 0,
    lastWebhookFailedCount: settings.lastWebhookFailedCount ?? 0,
    lastWebhookError: settings.lastWebhookError ?? null,
  };
  await mutateStore((store) => {
    const currentMap = store.lineSettingsByUser || {};
    const current = currentMap[scopeKey] || (scopeKey === GLOBAL_LINE_SETTINGS_SCOPE ? store.lineSettings : null);
    const merged: LineIntegrationSettings = {
      ...nextSettings,
      updatedAt: nowIso(),
      lastWebhookAt: current?.lastWebhookAt ?? nextSettings.lastWebhookAt,
      lastWebhookEventCount: current?.lastWebhookEventCount ?? nextSettings.lastWebhookEventCount ?? 0,
      lastWebhookProcessedCount:
        current?.lastWebhookProcessedCount ?? nextSettings.lastWebhookProcessedCount ?? 0,
      lastWebhookFailedCount: current?.lastWebhookFailedCount ?? nextSettings.lastWebhookFailedCount ?? 0,
      lastWebhookError: current?.lastWebhookError ?? nextSettings.lastWebhookError ?? null,
    };
    store.lineSettingsByUser = {
      ...currentMap,
      [scopeKey]: merged,
    };
    if (scopeKey === GLOBAL_LINE_SETTINGS_SCOPE) {
      store.lineSettings = merged;
    }
  });
  return (await getLineSettings(scopeKey)) || nextSettings;
}

export async function updateLineWebhookStats(
  patch: Pick<
    LineIntegrationSettings,
    | "lastWebhookAt"
    | "lastWebhookEventCount"
    | "lastWebhookProcessedCount"
    | "lastWebhookFailedCount"
    | "lastWebhookError"
  >,
  userScopeId?: string,
): Promise<LineIntegrationSettings | null> {
  const scopeKey = resolveLineScopeKey(userScopeId);
  let updated: LineIntegrationSettings | null = null;
  await mutateStore((store) => {
    const map = store.lineSettingsByUser || {};
    const current =
      map[scopeKey] ||
      (scopeKey !== GLOBAL_LINE_SETTINGS_SCOPE ? map[GLOBAL_LINE_SETTINGS_SCOPE] : null) ||
      store.lineSettings;
    if (!current) {
      return;
    }
    updated = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
      lastWebhookEventCount:
        patch.lastWebhookEventCount !== undefined
          ? Number(patch.lastWebhookEventCount)
          : current.lastWebhookEventCount ?? 0,
      lastWebhookProcessedCount:
        patch.lastWebhookProcessedCount !== undefined
          ? Number(patch.lastWebhookProcessedCount)
          : current.lastWebhookProcessedCount ?? 0,
      lastWebhookFailedCount:
        patch.lastWebhookFailedCount !== undefined
          ? Number(patch.lastWebhookFailedCount)
          : current.lastWebhookFailedCount ?? 0,
      lastWebhookError: patch.lastWebhookError !== undefined ? patch.lastWebhookError : current.lastWebhookError ?? null,
    };
    store.lineSettingsByUser = {
      ...map,
      [scopeKey]: updated!,
    };
    if (scopeKey === GLOBAL_LINE_SETTINGS_SCOPE) {
      store.lineSettings = updated!;
    }
  });
  return updated;
}

export async function clearLineSettings(userScopeId?: string): Promise<void> {
  const scopeKey = resolveLineScopeKey(userScopeId);
  await mutateStore((store) => {
    const map = { ...(store.lineSettingsByUser || {}) };
    delete map[scopeKey];
    store.lineSettingsByUser = map;
    if (scopeKey === GLOBAL_LINE_SETTINGS_SCOPE) {
      store.lineSettings = null;
    }
  });
}

export interface ListContactsOptions {
  userId?: string;
  search?: string;
  tag?: string;
}

export async function listContacts(options: ListContactsOptions = {}): Promise<CrmContact[]> {
  const { search, tag } = options;
  const store = await getStore();
  const searchKey = search?.trim().toLowerCase();
  const tagKey = tag?.trim();
  const filterUserId = options.userId?.trim();

  return store.contacts
    .filter((contact) => {
      // User scope: only show contacts owned by this user.
      // The LINE OA is a single shared account stored under the global scope,
      // so its contacts (created by the webhook) carry userId="__global__".
      // Surface those to every authenticated user — otherwise received LINE
      // messages exist in the store but are filtered out of everyone's view.
      if (
        filterUserId &&
        contact.userId &&
        contact.userId !== filterUserId &&
        contact.userId !== GLOBAL_LINE_SETTINGS_SCOPE
      ) {
        return false;
      }
      // Hide legacy contacts without userId when a userId filter is active
      if (filterUserId && !contact.userId) {
        return false;
      }

      const hitSearch = !searchKey
        ? true
        : [
            contact.displayName,
            contact.email ?? "",
            contact.phone ?? "",
            contact.lineUserId ?? "",
            ...contact.tags,
          ]
            .join(" ")
            .toLowerCase()
            .includes(searchKey);

      const hitTag = !tagKey ? true : contact.tags.includes(tagKey);
      return hitSearch && hitTag;
    })
    .sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return timeB - timeA;
    });
}

export async function getContactById(contactId: string): Promise<CrmContact | null> {
  const store = await getStore();
  return store.contacts.find((contact) => contact.id === contactId) ?? null;
}

export async function updateContact(
  contactId: string,
  patch: Partial<Pick<CrmContact, "displayName" | "email" | "phone" | "status" | "avatarUrl" | "company" | "title" | "address" | "notes" | "cardImageUrl">>,
): Promise<CrmContact | null> {
  return mutateStore((store) => {
    const index = store.contacts.findIndex((contact) => contact.id === contactId);
    if (index < 0) {
      return null;
    }

    const current = store.contacts[index];
    const next: CrmContact = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    store.contacts[index] = next;
    return next;
  });
}

export interface UpsertLineContactInput {
  lineUserId: string;
  displayName: string;
  avatarUrl?: string | null;
  userId?: string;
}

export async function upsertLineContact(input: UpsertLineContactInput): Promise<CrmContact> {
  return mutateStore((store) => {
    const now = nowIso();
    const incomingName = input.displayName.trim();
    // A "fallback" name is one we synthesized when the LINE profile fetch failed
    // (e.g. "LINE 使用者 ab12cd" / "LINE 群組 …"). It must NEVER overwrite a real
    // display name we captured earlier.
    const isFallbackName = (n: string): boolean =>
      !n || /^LINE (使用者|群組|聊天室) /.test(n);
    const normalizedName = incomingName || `LINE 使用者 ${input.lineUserId.slice(-6)}`;

    const existingIndex = store.contacts.findIndex(
      (contact) => contact.lineUserId === input.lineUserId,
    );

    const scopeId = input.userId?.trim() || undefined;

    if (existingIndex >= 0) {
      const existing = store.contacts[existingIndex];
      const existingNameIsReal = existing.displayName && !isFallbackName(existing.displayName);
      // Keep the existing real name unless the incoming name is also real.
      const nextName =
        existingNameIsReal && isFallbackName(normalizedName)
          ? existing.displayName
          : normalizedName;
      const updated: CrmContact = {
        ...existing,
        // never clobber a good name/avatar with a fallback / null
        displayName: nextName,
        avatarUrl: input.avatarUrl ?? existing.avatarUrl ?? null,
        source: "line",
        userId: existing.userId ?? scopeId,
        updatedAt: now,
      };
      store.contacts[existingIndex] = updated;
      return updated;
    }

    const created: CrmContact = {
      id: createId("contact"),
      source: "line",
      lineUserId: input.lineUserId,
      userId: scopeId,
      displayName: normalizedName,
      avatarUrl: input.avatarUrl ?? null,
      tags: [],
      status: "new",
      unread: 0,
      createdAt: now,
      updatedAt: now,
    };

    store.contacts.push(created);
    return created;
  });
}

export interface EnsureCrmContactInput {
  userId?: string;
  source?: "line" | "manual";
  lineUserId?: string;
  displayName: string;
  avatarUrl?: string | null;
  email?: string;
  phone?: string;
  status?: CrmContact["status"];
  tags?: string[];
}

export async function ensureCrmContact(input: EnsureCrmContactInput): Promise<CrmContact> {
  return mutateStore((store) => {
    const now = nowIso();
    const normalizedName = input.displayName.trim() || "未命名客戶";
    const normalizedSource =
      input.source === "line" || input.lineUserId ? ("line" as const) : ("manual" as const);
    const lineUserId = input.lineUserId?.trim() || undefined;

    let contactIndex = -1;
    if (lineUserId) {
      contactIndex = store.contacts.findIndex((contact) => contact.lineUserId === lineUserId);
    }
    if (contactIndex < 0) {
      contactIndex = store.contacts.findIndex(
        (contact) =>
          contact.displayName.trim() === normalizedName && contact.source === normalizedSource,
      );
    }

    if (contactIndex < 0) {
      const created: CrmContact = {
        id: createId("contact"),
        userId: input.userId?.trim() || undefined,
        source: normalizedSource,
        lineUserId,
        displayName: normalizedName,
        avatarUrl: input.avatarUrl ?? null,
        tags: Array.from(new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
        status: input.status ?? "new",
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        unread: 0,
        createdAt: now,
        updatedAt: now,
      };
      store.contacts.push(created);
      return created;
    }

    const current = store.contacts[contactIndex];
    const nextTags = new Set<string>(current.tags);
    for (const tag of input.tags ?? []) {
      const trimmed = tag.trim();
      if (trimmed) {
        nextTags.add(trimmed);
      }
    }

    const next: CrmContact = {
      ...current,
      source: normalizedSource,
      lineUserId: lineUserId ?? current.lineUserId,
      displayName: normalizedName || current.displayName,
      avatarUrl: input.avatarUrl ?? current.avatarUrl ?? null,
      email: input.email?.trim() || current.email,
      phone: input.phone?.trim() || current.phone,
      status: input.status ?? current.status,
      tags: Array.from(nextTags),
      updatedAt: now,
    };
    store.contacts[contactIndex] = next;
    return next;
  });
}

export async function addTagToContact(contactId: string, tag: string): Promise<CrmContact | null> {
  const trimmed = tag.trim();
  if (!trimmed) {
    return getContactById(contactId);
  }

  return mutateStore((store) => {
    const index = store.contacts.findIndex((contact) => contact.id === contactId);
    if (index < 0) {
      return null;
    }

    const current = store.contacts[index];
    if (!current.tags.includes(trimmed)) {
      current.tags.push(trimmed);
    }
    current.updatedAt = nowIso();
    store.contacts[index] = current;
    return current;
  });
}

export async function removeTagFromContact(
  contactId: string,
  tag: string,
): Promise<CrmContact | null> {
  const trimmed = tag.trim();
  if (!trimmed) {
    return getContactById(contactId);
  }
  return mutateStore((store) => {
    const index = store.contacts.findIndex((contact) => contact.id === contactId);
    if (index < 0) {
      return null;
    }

    const current = store.contacts[index];
    current.tags = current.tags.filter((item) => item !== trimmed);
    current.updatedAt = nowIso();
    store.contacts[index] = current;
    return current;
  });
}

export async function listMessagesByContact(contactId: string): Promise<CrmMessage[]> {
  const store = await getStore();
  return store.messages
    .filter((message) => message.contactId === contactId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export async function markContactAsRead(contactId: string): Promise<void> {
  const store = await getStore();
  const index = store.contacts.findIndex((contact) => contact.id === contactId);
  if (index < 0) {
    return;
  }
  if ((store.contacts[index].unread || 0) <= 0) {
    return;
  }
  store.contacts[index].unread = 0;
  store.contacts[index].updatedAt = nowIso();
  await saveStore(store);
}

export interface CreateMessageInput
  extends Omit<CrmMessage, "id" | "timestamp" | "source" | "rawEvent"> {
  source?: CrmMessage["source"];
  timestamp?: string;
  rawEvent?: unknown;
}

export async function createMessage(input: CreateMessageInput): Promise<CrmMessage> {
  return mutateStore((store) => {
    if (input.lineMessageId) {
      const existing = store.messages.find((msg) => msg.lineMessageId === input.lineMessageId);
      if (existing) {
        return existing;
      }
    }

    const contact = store.contacts.find((item) => item.id === input.contactId);
    if (!contact) {
      throw new Error("Contact not found.");
    }

    const message: CrmMessage = {
      id: createId("msg"),
      contactId: input.contactId,
      source: input.source ?? "crm",
      direction: input.direction,
      senderType: input.senderType,
      messageType: input.messageType,
      text: input.text,
      attachment: input.attachment,
      lineMessageId: input.lineMessageId,
      timestamp: input.timestamp ?? nowIso(),
      rawEvent: input.rawEvent,
    };

    store.messages.push(message);

    contact.lastMessageText = buildMessagePreview(message);
    contact.lastMessageAt = message.timestamp;
    contact.updatedAt = nowIso();
    if (message.direction === "inbound") {
      contact.unread += 1;
    }

    return message;
  });
}

export interface ListProjectsOptions {
  userId?: string;
  search?: string;
  includeArchived?: boolean;
  includeFiled?: boolean;
  includeDeleted?: boolean;
}

export async function listProjects(options: ListProjectsOptions = {}): Promise<CrmProject[]> {
  const store = await getStore();
  let changed = purgeExpiredDeletedProjects(store);
  if (store.projects.length === 0) {
    store.projects.push(createSampleProject());
    changed = true;
  }
  if (changed) {
    await saveStore(store);
  }

  const searchKey = options.search?.trim().toLowerCase();
  const includeArchived = Boolean(options.includeArchived);
  const includeFiled = Boolean(options.includeFiled);
  const includeDeleted = Boolean(options.includeDeleted);
  const filterUserId = options.userId?.trim();

  return store.projects
    .filter((project) => {
      // User scope: only show projects owned by this user
      if (filterUserId && project.userId && project.userId !== filterUserId) {
        return false;
      }
      // Hide legacy projects without userId when a userId filter is active
      if (filterUserId && !project.userId) {
        return false;
      }
      if (!includeDeleted && project.deletedAt) {
        return false;
      }
      if (!includeArchived && project.archivedAt) {
        return false;
      }
      if (!includeFiled && project.filedAt) {
        return false;
      }
      if (!searchKey) {
        return true;
      }
      return [
        project.name,
        project.clientName,
        project.phase,
        project.budget,
        project.note ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchKey);
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getProjectById(projectId: string): Promise<CrmProject | null> {
  const store = await getStore();
  if (purgeExpiredDeletedProjects(store)) {
    await saveStore(store);
  }
  return store.projects.find((project) => project.id === projectId) ?? null;
}

export interface CreateProjectInput {
  userId?: string;
  name: string;
  clientName: string;
  status: CrmProject["status"];
  phase: string;
  budget: string;
  coverImageUrl?: string;
  linkedContactId?: string;
  note?: string;
  quotationItems?: ProjectQuotationItem[];
  dressSelectionRecords?: ProjectDressSelectionRecord[];
  quotationMeta?: ProjectQuotationMeta;
  workflowTasks?: ProjectWorkflowTask[];
  auspiciousPlan?: ProjectAuspiciousPlan;
  notificationEmail?: string;
  notificationTemplates?: ProjectNotificationTemplate[];
}

export async function createProject(input: CreateProjectInput): Promise<CrmProject> {
  const store = await getStore();

  const linkedContactId = input.linkedContactId?.trim();
  const normalizedLinkedContactId =
    linkedContactId && store.contacts.some((contact) => contact.id === linkedContactId)
      ? linkedContactId
      : undefined;

  const now = nowIso();
  const project: CrmProject = {
    id: createId("project"),
    userId: input.userId?.trim() || undefined,
    name: input.name.trim(),
    clientName: input.clientName.trim(),
    status: input.status,
    phase: input.phase.trim(),
    budget: input.budget.trim(),
    coverImageUrl: input.coverImageUrl?.trim() || getDefaultProjectCover(),
    linkedContactId: normalizedLinkedContactId,
    note: input.note?.trim() || "",
    quotationItems: normalizeQuotationItems(input.quotationItems),
    dressSelectionRecords: normalizeDressSelectionRecords(input.dressSelectionRecords),
    quotationMeta: normalizeQuotationMeta(input.quotationMeta),
    workflowTasks: normalizeWorkflowTasks(input.workflowTasks),
    auspiciousPlan: normalizeAuspiciousPlan(input.auspiciousPlan),
    notificationEmail: input.notificationEmail?.trim() || "",
    notificationTemplates: normalizeNotificationTemplates(input.notificationTemplates),
    archivedAt: undefined,
    filedAt: undefined,
    deletedAt: undefined,
    deletePurgeAt: undefined,
    createdAt: now,
    updatedAt: now,
  };

  store.projects.unshift(project);
  await saveStore(store);
  return project;
}

/* ================================================================
   Presentations (draft persistence)
   ================================================================ */

export interface ListPresentationsOptions {
  userId?: string;
  linkedProjectId?: string;
}

export async function listPresentations(
  options: ListPresentationsOptions = {},
): Promise<PresentationDraft[]> {
  const store = await getStore();
  const all = store.presentations ?? [];
  const filterUserId = options.userId?.trim();
  return all
    .filter((p) => {
      if (filterUserId && p.userId && p.userId !== filterUserId) return false;
      if (filterUserId && !p.userId) return false;
      if (options.linkedProjectId && p.linkedProjectId !== options.linkedProjectId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getPresentationById(id: string): Promise<PresentationDraft | null> {
  const store = await getStore();
  return (store.presentations ?? []).find((p) => p.id === id) ?? null;
}

export interface SavePresentationInput {
  id?: string;
  userId?: string;
  title: string;
  designerName?: string;
  briefDesc?: string;
  linkedProjectId?: string;
  slides: PresentationDraft["slides"];
  styleId?: string;
  step?: number;
}

/** Upsert a presentation draft (create if no id, else update in place). */
export async function savePresentation(input: SavePresentationInput): Promise<PresentationDraft> {
  return mutateStore((store) => {
    const now = nowIso();
    if (!store.presentations) store.presentations = [];

    if (input.id) {
      const idx = store.presentations.findIndex((p) => p.id === input.id);
      if (idx >= 0) {
        const existing = store.presentations[idx];
        const updated: PresentationDraft = {
          ...existing,
          title: input.title.trim() || existing.title,
          designerName: input.designerName ?? existing.designerName,
          briefDesc: input.briefDesc ?? existing.briefDesc,
          linkedProjectId: input.linkedProjectId ?? existing.linkedProjectId,
          slides: input.slides ?? existing.slides,
          styleId: input.styleId ?? existing.styleId,
          step: input.step ?? existing.step,
          updatedAt: now,
        };
        store.presentations[idx] = updated;
        return updated;
      }
    }

    const created: PresentationDraft = {
      id: input.id || createId("deck"),
      userId: input.userId?.trim() || undefined,
      title: input.title.trim() || "未命名簡報",
      designerName: input.designerName,
      briefDesc: input.briefDesc,
      linkedProjectId: input.linkedProjectId,
      slides: input.slides ?? [],
      styleId: input.styleId,
      step: input.step,
      createdAt: now,
      updatedAt: now,
    };
    store.presentations.push(created);
    return created;
  });
}

export async function deletePresentation(id: string): Promise<boolean> {
  return mutateStore((store) => {
    if (!store.presentations) return false;
    const before = store.presentations.length;
    store.presentations = store.presentations.filter((p) => p.id !== id);
    return store.presentations.length !== before;
  });
}

/* ================================================================
   Standard pricing table (per-user, editable)
   ================================================================ */

const pricingScopeKey = (userScopeId?: string): string =>
  normalizeLineScope(userScopeId) || GLOBAL_LINE_SETTINGS_SCOPE;

/**
 * Get a user's pricing table. If they have none yet, seed it from the default
 * and persist, so first-time users immediately have the standard table.
 */
export async function getPricingStandards(
  userScopeId: string,
  seed: Omit<PricingStandardItem, "id">[],
): Promise<PricingStandardItem[]> {
  const key = pricingScopeKey(userScopeId);
  const store = await getStore();
  const existing = store.pricingByUser?.[key];
  if (existing && existing.length > 0) {
    return existing.map((p) => ({ ...p }));
  }
  // seed
  const seeded: PricingStandardItem[] = seed.map((s) => ({
    ...s,
    id: createId("price"),
  }));
  await mutateStore((s) => {
    if (!s.pricingByUser) s.pricingByUser = {};
    if (!s.pricingByUser[key] || s.pricingByUser[key].length === 0) {
      s.pricingByUser[key] = seeded;
    }
  });
  return seeded;
}

/** Read a user's pricing table without seeding (used by AI prompt build). */
export async function peekPricingStandards(userScopeId: string): Promise<PricingStandardItem[]> {
  const key = pricingScopeKey(userScopeId);
  const store = await getStore();
  return (store.pricingByUser?.[key] ?? []).map((p) => ({ ...p }));
}

/** Replace a user's entire pricing table. */
export async function savePricingStandards(
  userScopeId: string,
  items: PricingStandardItem[],
): Promise<PricingStandardItem[]> {
  const key = pricingScopeKey(userScopeId);
  const normalized = items
    .filter((it) => it.name?.trim())
    .map((it) => ({
      id: it.id || createId("price"),
      name: it.name.trim(),
      unit: (it.unit || "").trim() || "式",
      unitPrice: Number(it.unitPrice) || 0,
      category: (it.category || "其他").trim(),
      aliases: Array.isArray(it.aliases)
        ? it.aliases.map((a) => String(a).trim()).filter(Boolean)
        : undefined,
      note: it.note?.trim() || undefined,
    }));
  await mutateStore((store) => {
    if (!store.pricingByUser) store.pricingByUser = {};
    store.pricingByUser[key] = normalized;
  });
  return normalized;
}

export interface UpdateProjectInput {
  name?: string;
  clientName?: string;
  status?: CrmProject["status"];
  phase?: string;
  budget?: string;
  coverImageUrl?: string;
  linkedContactId?: string | null;
  note?: string;
  quotationItems?: ProjectQuotationItem[];
  dressSelectionRecords?: ProjectDressSelectionRecord[];
  quotationMeta?: ProjectQuotationMeta;
  workflowTasks?: ProjectWorkflowTask[];
  auspiciousPlan?: ProjectAuspiciousPlan;
  notificationEmail?: string;
  notificationTemplates?: ProjectNotificationTemplate[];
}

export async function updateProject(
  projectId: string,
  patch: UpdateProjectInput,
): Promise<CrmProject | null> {
  const store = await getStore();
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return null;
  }

  const current = store.projects[index];
  const nextLinkedContactId =
    patch.linkedContactId === null
      ? undefined
      : patch.linkedContactId !== undefined
        ? patch.linkedContactId.trim() || undefined
        : current.linkedContactId;

  const normalizedLinkedContactId =
    nextLinkedContactId && store.contacts.some((contact) => contact.id === nextLinkedContactId)
      ? nextLinkedContactId
      : undefined;

  const now = nowIso();
  const nextStatus = patch.status ?? current.status;
  const nextFiledAt = current.filedAt;
  const nextArchivedAt = nextStatus === "completed" ? undefined : current.archivedAt;

  const next: CrmProject = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.clientName !== undefined ? { clientName: patch.clientName.trim() } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.phase !== undefined ? { phase: patch.phase.trim() } : {}),
    ...(patch.budget !== undefined ? { budget: patch.budget.trim() } : {}),
    ...(patch.coverImageUrl !== undefined
      ? { coverImageUrl: patch.coverImageUrl.trim() || getDefaultProjectCover() }
      : {}),
    linkedContactId: normalizedLinkedContactId,
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.quotationItems !== undefined ? { quotationItems: normalizeQuotationItems(patch.quotationItems) } : {}),
    ...(patch.dressSelectionRecords !== undefined
      ? { dressSelectionRecords: normalizeDressSelectionRecords(patch.dressSelectionRecords) }
      : {}),
    ...(patch.quotationMeta !== undefined ? { quotationMeta: normalizeQuotationMeta(patch.quotationMeta) } : {}),
    ...(patch.workflowTasks !== undefined ? { workflowTasks: normalizeWorkflowTasks(patch.workflowTasks) } : {}),
    ...(patch.auspiciousPlan !== undefined ? { auspiciousPlan: normalizeAuspiciousPlan(patch.auspiciousPlan) } : {}),
    ...(patch.notificationEmail !== undefined ? { notificationEmail: patch.notificationEmail.trim() } : {}),
    ...(patch.notificationTemplates !== undefined
      ? { notificationTemplates: normalizeNotificationTemplates(patch.notificationTemplates) }
      : {}),
    archivedAt: nextArchivedAt,
    filedAt: nextFiledAt,
    deletedAt: current.deletedAt,
    deletePurgeAt: current.deletePurgeAt,
    updatedAt: now,
  };

  store.projects[index] = next;
  await saveStore(store);
  return next;
}

export async function archiveProject(projectId: string): Promise<CrmProject | null> {
  const store = await getStore();
  if (purgeExpiredDeletedProjects(store)) {
    await saveStore(store);
  }
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return null;
  }
  const current = store.projects[index];
  const next: CrmProject = {
    ...current,
    archivedAt: current.archivedAt || nowIso(),
    filedAt: undefined,
    updatedAt: nowIso(),
  };
  store.projects[index] = next;
  await saveStore(store);
  return next;
}

export async function restoreProject(projectId: string): Promise<CrmProject | null> {
  const store = await getStore();
  if (purgeExpiredDeletedProjects(store)) {
    await saveStore(store);
  }
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return null;
  }
  const current = store.projects[index];
  const next: CrmProject = {
    ...current,
    archivedAt: undefined,
    updatedAt: nowIso(),
  };
  store.projects[index] = next;
  await saveStore(store);
  return next;
}

export async function fileProject(projectId: string): Promise<CrmProject | null> {
  const store = await getStore();
  if (purgeExpiredDeletedProjects(store)) {
    await saveStore(store);
  }
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return null;
  }
  const current = store.projects[index];
  const now = nowIso();
  const next: CrmProject = {
    ...current,
    status: "completed",
    filedAt: current.filedAt || now,
    archivedAt: undefined,
    updatedAt: now,
  };
  store.projects[index] = next;
  await saveStore(store);
  return next;
}

export async function unfileProject(projectId: string): Promise<CrmProject | null> {
  const store = await getStore();
  if (purgeExpiredDeletedProjects(store)) {
    await saveStore(store);
  }
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return null;
  }
  const current = store.projects[index];
  const next: CrmProject = {
    ...current,
    filedAt: undefined,
    updatedAt: nowIso(),
  };
  store.projects[index] = next;
  await saveStore(store);
  return next;
}

export async function moveProjectToTrash(projectId: string): Promise<CrmProject | null> {
  const store = await getStore();
  purgeExpiredDeletedProjects(store);
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return null;
  }
  const current = store.projects[index];
  const deletedAt = nowIso();
  const next: CrmProject = {
    ...current,
    deletedAt,
    deletePurgeAt: computeProjectDeletePurgeAt(new Date(deletedAt)),
    updatedAt: deletedAt,
  };
  store.projects[index] = next;
  await saveStore(store);
  return next;
}

export async function restoreProjectFromTrash(projectId: string): Promise<CrmProject | null> {
  const store = await getStore();
  if (purgeExpiredDeletedProjects(store)) {
    await saveStore(store);
  }
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) {
    return null;
  }
  const current = store.projects[index];
  const next: CrmProject = {
    ...current,
    deletedAt: undefined,
    deletePurgeAt: undefined,
    updatedAt: nowIso(),
  };
  store.projects[index] = next;
  await saveStore(store);
  return next;
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const moved = await moveProjectToTrash(projectId);
  return Boolean(moved);
}

export async function hardDeleteProject(projectId: string): Promise<boolean> {
  const store = await getStore();
  const before = store.projects.length;
  store.projects = store.projects.filter((project) => project.id !== projectId);
  if (store.projects.length === before) {
    return false;
  }
  await saveStore(store);
  return true;
}

export async function syncProjectNoteToCrm(projectId: string): Promise<{
  project: CrmProject;
  contact: CrmContact;
}> {
  const store = await getStore();
  const projectIndex = store.projects.findIndex((item) => item.id === projectId);
  if (projectIndex < 0) {
    throw new Error("Project not found.");
  }
  const project = store.projects[projectIndex];
  if (!project.linkedContactId) {
    throw new Error("Project has no linked CRM contact.");
  }
  const contactIndex = store.contacts.findIndex((item) => item.id === project.linkedContactId);
  if (contactIndex < 0) {
    throw new Error("Linked contact not found.");
  }

  const noteText = project.note?.trim();
  if (!noteText) {
    throw new Error("Project note is empty.");
  }

  const tag = `專案:${project.name}`;
  const contact = store.contacts[contactIndex];
  if (!contact.tags.includes(tag)) {
    contact.tags.push(tag);
  }
  contact.updatedAt = nowIso();
  store.contacts[contactIndex] = contact;

  const message: CrmMessage = {
    id: createId("msg"),
    contactId: contact.id,
    source: "crm",
    direction: "outbound",
    senderType: "system",
    messageType: "system",
    text: `[專案註記][${project.name}]\n${noteText}`,
    timestamp: nowIso(),
    rawEvent: {
      kind: "project-note-sync",
      projectId: project.id,
    },
  };
  store.messages.push(message);
  contact.lastMessageText = buildMessagePreview(message);
  contact.lastMessageAt = message.timestamp;

  const nextProject: CrmProject = {
    ...project,
    lastSyncedToCrmAt: message.timestamp,
    updatedAt: nowIso(),
  };
  store.projects[projectIndex] = nextProject;

  await saveStore(store);
  return {
    project: nextProject,
    contact,
  };
}
