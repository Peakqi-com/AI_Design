import { getServerSession } from "next-auth";
import { authConfig } from "@/lib/auth";
import { listContentVaultItems, saveContentVaultItem } from "@/lib/content/vault";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";

export const FREE_GOOGLE_INITIAL_CREDITS = 30;
export const SOCIAL_IMAGE_COST = 1;
export const SOCIAL_VIDEO_COST = 20;
const CREDIT_WALLET_UPSERT_KEY = "credit_wallet_main";

type Plan = "free" | "pro" | "enterprise";
type GenerationAction = "social-image" | "social-video";

interface CreditWalletPayload {
  balance: number;
  initialCredits: number;
  totalSpent: number;
  imageGeneratedCount: number;
  videoGeneratedCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CreditWalletRecord {
  id: string;
  payload: CreditWalletPayload;
}

export interface CreditGateContext {
  userId: string;
  shouldEnforce: boolean;
  plan: Plan;
  authProvider: string;
  initialCredits: number;
  imageCost: number;
  videoCost: number;
  upgradeMessage: string;
}

export interface CreditConsumeResult {
  ok: boolean;
  remainingCredits: number;
  cost: number;
  requiredCredits?: number;
  upgradeMessage: string;
}

const toFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parsePlan = (value: unknown): Plan =>
  value === "pro" || value === "enterprise" ? value : "free";

const nowIso = (): string => new Date().toISOString();

const createDefaultWallet = (initialCredits: number): CreditWalletPayload => {
  const normalizedInitial = Math.max(0, Math.floor(initialCredits));
  const now = nowIso();
  return {
    balance: normalizedInitial,
    initialCredits: normalizedInitial,
    totalSpent: 0,
    imageGeneratedCount: 0,
    videoGeneratedCount: 0,
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeWalletPayload = (
  payload: unknown,
  initialCredits: number,
): CreditWalletPayload => {
  if (!payload || typeof payload !== "object") {
    return createDefaultWallet(initialCredits);
  }
  const wallet = payload as Partial<CreditWalletPayload>;
  const normalizedInitial = Math.max(
    0,
    Math.floor(toFiniteNumber(wallet.initialCredits, initialCredits)),
  );
  return {
    balance: Math.max(0, Math.floor(toFiniteNumber(wallet.balance, normalizedInitial))),
    initialCredits: normalizedInitial,
    totalSpent: Math.max(0, Math.floor(toFiniteNumber(wallet.totalSpent, 0))),
    imageGeneratedCount: Math.max(0, Math.floor(toFiniteNumber(wallet.imageGeneratedCount, 0))),
    videoGeneratedCount: Math.max(0, Math.floor(toFiniteNumber(wallet.videoGeneratedCount, 0))),
    createdAt: String(wallet.createdAt || nowIso()),
    updatedAt: String(wallet.updatedAt || nowIso()),
  };
};

const isFreeGoogleAccount = (input: {
  plan?: unknown;
  authProvider?: unknown;
}): boolean => parsePlan(input.plan) === "free" && String(input.authProvider || "") === "google";

const loadWalletRecord = async (
  userId: string,
  initialCredits: number,
): Promise<CreditWalletRecord> => {
  const items = await listContentVaultItems({
    userId,
    kind: "general",
    limit: 120,
  });
  const existing = items.find((item) => item.upsertKey === CREDIT_WALLET_UPSERT_KEY);
  if (existing) {
    return {
      id: existing.id,
      payload: normalizeWalletPayload(existing.payload, initialCredits),
    };
  }
  const createdPayload = createDefaultWallet(initialCredits);
  const created = await saveContentVaultItem({
    userId,
    kind: "general",
    title: "點數錢包",
    summary: `剩餘 ${createdPayload.balance} 點`,
    upsertKey: CREDIT_WALLET_UPSERT_KEY,
    payload: createdPayload,
  });
  return {
    id: created.id,
    payload: createdPayload,
  };
};

const saveWalletRecord = async (input: {
  userId: string;
  record: CreditWalletRecord;
}): Promise<void> => {
  await saveContentVaultItem({
    id: input.record.id,
    userId: input.userId,
    kind: "general",
    title: "點數錢包",
    summary: `剩餘 ${input.record.payload.balance} 點`,
    upsertKey: CREDIT_WALLET_UPSERT_KEY,
    payload: input.record.payload,
  });
};

export const resolveCreditGateContext = async (
  requestedUserId?: string,
): Promise<CreditGateContext> => {
  const session = await getServerSession(authConfig);
  const sessionUser = (session?.user || {}) as {
    plan?: unknown;
    authProvider?: unknown;
  };
  const userId = await resolveServerUserScopeId(requestedUserId);
  const plan = parsePlan(sessionUser.plan);
  const authProvider = String(sessionUser.authProvider || "");
  const shouldEnforce = isFreeGoogleAccount({ plan, authProvider });

  return {
    userId,
    shouldEnforce,
    plan,
    authProvider,
    initialCredits: FREE_GOOGLE_INITIAL_CREDITS,
    imageCost: SOCIAL_IMAGE_COST,
    videoCost: SOCIAL_VIDEO_COST,
    upgradeMessage: "點數不足，請開啟付費會員功能。",
  };
};

export const getCreditWalletBalance = async (
  context: CreditGateContext,
): Promise<number | null> => {
  if (!context.shouldEnforce) {
    return null;
  }
  const record = await loadWalletRecord(context.userId, context.initialCredits);
  return record.payload.balance;
};

export const consumeCreditWallet = async (input: {
  context: CreditGateContext;
  cost: number;
  action: GenerationAction;
}): Promise<CreditConsumeResult> => {
  const normalizedCost = Math.max(0, Math.floor(input.cost));
  if (!input.context.shouldEnforce || normalizedCost <= 0) {
    return {
      ok: true,
      remainingCredits: Number.POSITIVE_INFINITY,
      cost: normalizedCost,
      upgradeMessage: input.context.upgradeMessage,
    };
  }

  const record = await loadWalletRecord(input.context.userId, input.context.initialCredits);
  if (record.payload.balance < normalizedCost) {
    return {
      ok: false,
      remainingCredits: record.payload.balance,
      cost: normalizedCost,
      requiredCredits: normalizedCost,
      upgradeMessage: input.context.upgradeMessage,
    };
  }

  const now = nowIso();
  record.payload.balance -= normalizedCost;
  record.payload.totalSpent += normalizedCost;
  record.payload.updatedAt = now;
  if (input.action === "social-image") {
    record.payload.imageGeneratedCount += 1;
  } else if (input.action === "social-video") {
    record.payload.videoGeneratedCount += 1;
  }
  await saveWalletRecord({
    userId: input.context.userId,
    record,
  });

  return {
    ok: true,
    remainingCredits: record.payload.balance,
    cost: normalizedCost,
    upgradeMessage: input.context.upgradeMessage,
  };
};

export const refundCreditWallet = async (input: {
  context: CreditGateContext;
  cost: number;
}): Promise<number | null> => {
  const normalizedCost = Math.max(0, Math.floor(input.cost));
  if (!input.context.shouldEnforce || normalizedCost <= 0) {
    return null;
  }

  const record = await loadWalletRecord(input.context.userId, input.context.initialCredits);
  record.payload.balance += normalizedCost;
  record.payload.updatedAt = nowIso();
  await saveWalletRecord({
    userId: input.context.userId,
    record,
  });
  return record.payload.balance;
};
