/**
 * Credits persistence layer — Redis primary, in-memory fallback.
 *
 * Each user has a record keyed by their userScopeId:
 *   { credits, plan, createdAt, updatedAt }
 *
 * Plan tiers:
 *   free        → 30  initial credits, no monthly refresh
 *   pro         → 800 credits/month  (NT$2,500)
 *   business    → 2400 credits/month (NT$6,600)
 *   enterprise  → custom
 */

import { Redis } from "@upstash/redis";

/* ---------- types ---------- */

export type UserPlan = "free" | "pro" | "business" | "enterprise";

export interface UserCreditRecord {
  userId: string;
  plan: UserPlan;
  credits: number;
  totalUsed: number;
  createdAt: string;
  updatedAt: string;
  isAdmin?: boolean;
}

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
  free: 30,
  pro: 800,
  business: 2400,
  enterprise: 9999,
};

export const CREDIT_COSTS: Record<string, number> = {
  "ai-render": 2,
  "ai-render-analyze": 2,
  "ai-render-regional": 2,
  "ai-video": 5,
  "ai-upscale": 1,
  "ai-social-post": 1,
  "ai-social-image": 1,
  "ai-presentation": 2,
};

/* ---------- in-memory fallback ---------- */

const memoryStore = new Map<string, UserCreditRecord>();

/* ---------- helpers ---------- */

const userKey = (userId: string) => `${CREDITS_KEY_PREFIX}${userId}`;

export const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
};

/* ---------- CRUD ---------- */

export async function getUserCredits(userId: string): Promise<UserCreditRecord> {
  // Try Redis
  if (redis) {
    try {
      const raw = await redis.get<UserCreditRecord>(userKey(userId));
      if (raw) {
        memoryStore.set(userId, raw);
        return raw;
      }
    } catch {
      // fallback to memory
    }
  }

  // Memory fallback
  const cached = memoryStore.get(userId);
  if (cached) return cached;

  // New user → create with free plan
  const record: UserCreditRecord = {
    userId,
    plan: "free",
    credits: PLAN_INITIAL_CREDITS.free,
    totalUsed: 0,
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
  const cost = CREDIT_COSTS[action] ?? 2;
  const record = await getUserCredits(userId);

  if (record.credits < cost) {
    return {
      success: false,
      remaining: record.credits,
      cost,
      error: `點數不足（需要 ${cost} 點，目前剩餘 ${record.credits} 點）`,
    };
  }

  record.credits -= cost;
  record.totalUsed += cost;
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
    label: "免費體驗版",
    price: "NT$ 0",
    creditsPerMonth: 30,
    features: ["AI 空間渲染", "多視角輸出", "媒體庫", "簡報製作"],
  },
  pro: {
    label: "專業版",
    price: "NT$ 2,500 / 月",
    creditsPerMonth: 800,
    features: ["AI 空間渲染", "多視角輸出", "媒體庫", "簡報製作", "社群發文中心", "AI 報價"],
  },
  business: {
    label: "商務版",
    price: "NT$ 6,600 / 月",
    creditsPerMonth: 2400,
    features: ["所有專業版功能", "客戶關係 CRM", "專案管理", "優先算力", "專屬客服"],
  },
  enterprise: {
    label: "企業版",
    price: "聯繫業務",
    creditsPerMonth: 9999,
    features: ["全功能客製化", "無限點數", "API 存取", "專屬部署", "SLA 保證"],
  },
};

/**
 * Feature access by plan — returns true if the user's plan allows access.
 */
const FEATURE_ACCESS: Record<string, UserPlan[]> = {
  "ai-studio": ["free", "pro", "business", "enterprise"],
  "video-studio": ["free", "pro", "business", "enterprise"],
  "media-library": ["free", "pro", "business", "enterprise"],
  presentation: ["free", "pro", "business", "enterprise"],
  marketing: ["pro", "business", "enterprise"],
  quotation: ["pro", "business", "enterprise"],
  crm: ["business", "enterprise"],
  projects: ["business", "enterprise"],
};

export function canAccessFeature(plan: UserPlan, feature: string): boolean {
  const allowed = FEATURE_ACCESS[feature];
  if (!allowed) return true; // unknown features default to allowed
  return allowed.includes(plan);
}
