/**
 * Credits persistence layer — Redis primary, in-memory fallback.
 *
 * Plan tiers (依 2026-04-29 成本計算表):
 *   free        → 50   點（一次性體驗，無每月重置）
 *   pro         → 500  點/月  (NT$2,500 / 月，年費 NT$30,000)
 *   business    → 1500 點/月  (NT$6,600 / 月，年費 NT$79,800)
 *   enterprise  → 客製化
 *
 * 扣點規則：
 *   圖片 = 0.55 點 / 張   (ai-render*, ai-upscale, ai-social-image, ai-presentation)
 *   影片 = 12.5 點 / 部   (ai-video — 不分中國/美國產地)
 *   文字 = 0.15 點 / 則   (ai-social-post, ai-text)
 */

import { Redis } from "@upstash/redis";

/* ---------- types ---------- */

export type UserPlan = "free" | "pro" | "business" | "enterprise";
export type AdminRole = "super-admin" | "admin" | "none";

const SUPER_ADMIN_EMAIL = "ai.allen.task@gmail.com";

export function getAdminRole(email: string | null | undefined, isAdminFlag?: boolean): AdminRole {
  if (!email) return isAdminFlag ? "admin" : "none";
  if (email.trim().toLowerCase() === SUPER_ADMIN_EMAIL) return "super-admin";
  if (isAdminFlag) return "admin";
  return "none";
}

export interface UserCreditRecord {
  userId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  plan: UserPlan;
  credits: number;
  totalUsed: number;
  storageUsedBytes: number;
  createdAt: string;
  updatedAt: string;
  isAdmin?: boolean;
}

const STORAGE_QUOTA_BYTES: Record<UserPlan, number> = {
  free: 50 * 1024 * 1024,       // 50 MB
  pro: 500 * 1024 * 1024,       // 500 MB
  business: 2 * 1024 * 1024 * 1024, // 2 GB
  enterprise: 10 * 1024 * 1024 * 1024, // 10 GB
};

export interface CreditCost {
  action: string;
  cost: number;
}

/* ---------- constants ---------- */

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

const CREDITS_KEY_PREFIX = "credits:user:";
const ALL_USERS_KEY = "credits:all_users"; // Redis SET of all user IDs

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "ai.allen.task@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const PLAN_INITIAL_CREDITS: Record<UserPlan, number> = {
  free: 50,
  pro: 500,
  business: 1500,
  enterprise: 9999,
};

const CREDIT_COST_IMAGE = 0.55;
const CREDIT_COST_VIDEO = 12.5;
const CREDIT_COST_TEXT = 0.15;

export const CREDIT_COSTS: Record<string, number> = {
  "ai-render": CREDIT_COST_IMAGE,
  "ai-render-analyze": CREDIT_COST_IMAGE,
  "ai-render-regional": CREDIT_COST_IMAGE,
  "ai-upscale": CREDIT_COST_IMAGE,
  "ai-social-image": CREDIT_COST_IMAGE,
  "ai-presentation": CREDIT_COST_IMAGE,
  "ai-video": CREDIT_COST_VIDEO,
  "ai-social-post": CREDIT_COST_TEXT,
  "ai-text": CREDIT_COST_TEXT,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- in-memory fallback ---------- */

const memoryStore = new Map<string, UserCreditRecord>();

/* ---------- helpers ---------- */

const userKey = (userId: string) => `${CREDITS_KEY_PREFIX}${userId}`;

export const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
};

/* ---------- CRUD ---------- */

export interface UserProfileInfo {
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export async function getUserCredits(userId: string, profile?: UserProfileInfo): Promise<UserCreditRecord> {
  // Try Redis
  if (redis) {
    try {
      const raw = await redis.get<UserCreditRecord>(userKey(userId));
      if (raw) {
        // Sync profile if provided and changed
        let dirty = false;
        if (profile?.email && raw.email !== profile.email) { raw.email = profile.email; dirty = true; }
        if (profile?.name && raw.name !== profile.name) { raw.name = profile.name; dirty = true; }
        if (profile?.avatarUrl && raw.avatarUrl !== profile.avatarUrl) { raw.avatarUrl = profile.avatarUrl; dirty = true; }
        if (dirty) await saveUserCredits(raw);
        memoryStore.set(userId, raw);
        return raw;
      }
    } catch {
      // fallback to memory
    }
  }

  // Memory fallback
  const cached = memoryStore.get(userId);
  if (cached) {
    let dirty = false;
    if (profile?.email && cached.email !== profile.email) { cached.email = profile.email; dirty = true; }
    if (profile?.name && cached.name !== profile.name) { cached.name = profile.name; dirty = true; }
    if (profile?.avatarUrl && cached.avatarUrl !== profile.avatarUrl) { cached.avatarUrl = profile.avatarUrl; dirty = true; }
    if (dirty) await saveUserCredits(cached);
    return cached;
  }

  // New user → create with free plan
  const record: UserCreditRecord = {
    userId,
    email: profile?.email,
    name: profile?.name,
    avatarUrl: profile?.avatarUrl,
    plan: "free",
    credits: PLAN_INITIAL_CREDITS.free,
    totalUsed: 0,
    storageUsedBytes: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveUserCredits(record);
  return record;
}

export async function saveUserCredits(record: UserCreditRecord): Promise<void> {
  record.updatedAt = new Date().toISOString();
  memoryStore.set(record.userId, record);
  if (redis) {
    try {
      await redis.set(userKey(record.userId), record);
      // Track user in the all-users set
      await redis.sadd(ALL_USERS_KEY, record.userId);
    } catch {
      // ignore Redis errors, memory store is still valid
    }
  }
}

/**
 * Deduct credits. Returns { success, remaining } or { success: false, error }.
 */
export async function deductCredits(
  userId: string,
  action: string,
): Promise<{ success: boolean; remaining: number; cost: number; error?: string }> {
  const cost = CREDIT_COSTS[action] ?? CREDIT_COST_IMAGE;
  const record = await getUserCredits(userId);

  if (record.credits < cost) {
    return {
      success: false,
      remaining: round2(record.credits),
      cost,
      error: `點數不足（需要 ${cost} 點，目前剩餘 ${round2(record.credits)} 點）`,
    };
  }

  record.credits = round2(record.credits - cost);
  record.totalUsed = round2(record.totalUsed + cost);
  await saveUserCredits(record);

  return { success: true, remaining: record.credits, cost };
}

/**
 * Set user plan and reset credits to the plan's initial amount.
 */
export async function setUserPlan(
  userId: string,
  plan: UserPlan,
  customCredits?: number,
): Promise<UserCreditRecord> {
  const record = await getUserCredits(userId);
  record.plan = plan;
  record.credits = customCredits ?? PLAN_INITIAL_CREDITS[plan];
  await saveUserCredits(record);
  return record;
}

/**
 * Admin: add credits to a user.
 */
export async function addCredits(userId: string, amount: number): Promise<UserCreditRecord> {
  const record = await getUserCredits(userId);
  record.credits += amount;
  await saveUserCredits(record);
  return record;
}

/**
 * Admin: set admin flag.
 */
export async function setAdminFlag(userId: string, isAdmin: boolean): Promise<void> {
  const record = await getUserCredits(userId);
  record.isAdmin = isAdmin;
  await saveUserCredits(record);
}

/**
 * Admin: list all registered users.
 */
export async function listAllUsers(): Promise<UserCreditRecord[]> {
  // Try Redis set
  if (redis) {
    try {
      const userIds = await redis.smembers(ALL_USERS_KEY);
      if (userIds && userIds.length > 0) {
        const records = await Promise.all(
          userIds.map(async (id) => {
            try {
              const raw = await redis.get<UserCreditRecord>(userKey(id));
              return raw;
            } catch {
              return null;
            }
          }),
        );
        return records.filter((r): r is UserCreditRecord => r !== null);
      }
    } catch {
      // fallback
    }
  }

  // Memory fallback
  return Array.from(memoryStore.values());
}

/**
 * Get plan display info
 */
export const PLAN_INFO: Record<UserPlan, { label: string; price: string; creditsPerMonth: number; features: string[] }> = {
  free: {
    label: "10 天免費體驗版",
    price: "NT$ 0",
    creditsPerMonth: 50,
    features: ["AI 室內設計風格套用", "AI 空間渲染", "AI 彩色平面圖", "AI 立體平面圖", "AI 動畫影片", "AI 社群發文中心"],
  },
  pro: {
    label: "專業版",
    price: "NT$ 2,500 / 月",
    creditsPerMonth: 500,
    features: ["AI 室內設計風格套用", "AI 空間渲染", "AI 彩色/立體平面圖", "AI 立面圖、材料說明", "AI 簡報製作", "AI 動畫影片", "AI 社群發文中心", "客戶 CRM 系統", "媒體庫（可自行上傳）", "作品無浮水印"],
  },
  business: {
    label: "商務版",
    price: "NT$ 6,600 / 月",
    creditsPerMonth: 1500,
    features: ["所有專業版功能", "圖片畫質增強", "優先算力支持", "免費行銷文案創作", "新功能優先體驗內測"],
  },
  enterprise: {
    label: "企業版",
    price: "聯繫客服",
    creditsPerMonth: 9999,
    features: ["每月客製化點數", "所有商務版功能", "API 串接存取", "客製化企業 AI 功能", "企業專屬 AI 部署", "SLA 服務保證", "專屬客戶客服經理"],
  },
};

export const CREDIT_RATES = {
  image: CREDIT_COST_IMAGE,
  video: CREDIT_COST_VIDEO,
  text: CREDIT_COST_TEXT,
} as const;

/**
 * Format credits for display — integers show as-is, fractions show 2 decimals.
 * e.g. 500 → "500", 499.45 → "499.45", 12.5 → "12.5"
 */
export function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  const rounded = round2(value);
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2).replace(/0$/, "");
}

/**
 * Feature access by plan — returns true if the user's plan allows access.
 */
const FEATURE_ACCESS: Record<string, UserPlan[]> = {
  "ai-studio": ["free", "pro", "business", "enterprise"],
  "ai-chat": ["free", "pro", "business", "enterprise"],
  "video-studio": ["free", "pro", "business", "enterprise"],
  "media-library": ["free", "pro", "business", "enterprise"],
  presentation: ["pro", "business", "enterprise"],
  marketing: ["free", "pro", "business", "enterprise"],
  subscription: ["free", "pro", "business", "enterprise"],
  "video-script": ["pro", "business", "enterprise"],
  quotation: ["pro", "business", "enterprise"],
  crm: ["pro", "business", "enterprise"],
  projects: ["pro", "business", "enterprise"],
};

export function canAccessFeature(plan: UserPlan, feature: string): boolean {
  const allowed = FEATURE_ACCESS[feature];
  if (!allowed) return true; // unknown features default to allowed
  return allowed.includes(plan);
}

/**
 * Get storage quota for a plan (in bytes).
 */
export function getStorageQuota(plan: UserPlan): number {
  return STORAGE_QUOTA_BYTES[plan] ?? STORAGE_QUOTA_BYTES.free;
}

/**
 * Check if user has enough storage space.
 */
export async function checkStorageQuota(
  userId: string,
  additionalBytes: number,
): Promise<{ allowed: boolean; usedBytes: number; quotaBytes: number; remainingBytes: number }> {
  const record = await getUserCredits(userId);
  const used = record.storageUsedBytes || 0;
  const quota = getStorageQuota(record.plan);
  const remaining = Math.max(0, quota - used);
  return {
    allowed: used + additionalBytes <= quota,
    usedBytes: used,
    quotaBytes: quota,
    remainingBytes: remaining,
  };
}

/**
 * Add to user's storage usage (call after successful upload).
 */
export async function addStorageUsage(userId: string, bytes: number): Promise<void> {
  const record = await getUserCredits(userId);
  record.storageUsedBytes = (record.storageUsedBytes || 0) + bytes;
  await saveUserCredits(record);
}

/**
 * Subtract from user's storage usage (call after delete).
 */
export async function subtractStorageUsage(userId: string, bytes: number): Promise<void> {
  const record = await getUserCredits(userId);
  record.storageUsedBytes = Math.max(0, (record.storageUsedBytes || 0) - bytes);
  await saveUserCredits(record);
}

/**
 * Format bytes to human readable.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
