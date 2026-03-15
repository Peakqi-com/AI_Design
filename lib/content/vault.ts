import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { Redis } from "@upstash/redis";

export type ContentVaultKind = "marketing-state" | "social-post" | "general";

export interface ContentVaultItem {
  id: string;
  userId: string;
  kind: ContentVaultKind;
  title: string;
  summary?: string;
  payload?: unknown;
  upsertKey?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  deletedAt?: string;
  deletePurgeAt?: string;
}

interface ContentVaultStore {
  version: number;
  items: ContentVaultItem[];
}

export interface ListContentVaultOptions {
  userId: string;
  kind?: ContentVaultKind;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}

export interface SaveContentVaultInput {
  id?: string;
  userId: string;
  kind: ContentVaultKind;
  title: string;
  summary?: string;
  payload?: unknown;
  upsertKey?: string;
}

const STORE_VERSION = 1;
const MAX_ITEMS = 1200;
const DELETE_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.CONTENT_VAULT_DELETE_RETENTION_DAYS || 30),
);
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_STORE_KEY = process.env.CONTENT_VAULT_REDIS_KEY || "content:vault:store:v1";
const FORCE_FILE_STORAGE = /^(1|true|yes)$/i.test(process.env.CONTENT_VAULT_FORCE_FILE_STORAGE || "");
const REDIS_COOLDOWN_MS = Number(process.env.CONTENT_VAULT_REDIS_COOLDOWN_MS || 30 * 60 * 1000);
const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;
const DATA_DIR =
  process.env.CONTENT_VAULT_DATA_DIR ||
  (process.env.VERCEL ? "/tmp/aiinterior-content-vault" : path.join(process.cwd(), ".data"));
const STORE_FILE = path.join(DATA_DIR, "content-vault-store.json");

let memoryStore: ContentVaultStore | null = null;
let redisDisabledUntil = 0;

const nowIso = (): string => new Date().toISOString();

const normalizeUserId = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

const createDefaultStore = (): ContentVaultStore => ({
  version: STORE_VERSION,
  items: [],
});

const cloneStore = (store: ContentVaultStore): ContentVaultStore => structuredClone(store);

const normalizeStore = (raw: unknown): ContentVaultStore => {
  if (!raw || typeof raw !== "object") {
    return createDefaultStore();
  }
  const maybe = raw as Partial<ContentVaultStore>;
  return {
    version: STORE_VERSION,
    items: Array.isArray(maybe.items) ? maybe.items : [],
  };
};

const isReadonlyFsError = (error: unknown): boolean =>
  Boolean(error instanceof Error && /EROFS|EACCES|EPERM/i.test(error.message));

const isRedisQuotaError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /max requests limit exceeded|err max requests limit exceeded|too many requests/i.test(
    error.message.toLowerCase(),
  );
};

const canUseRedis = (): boolean =>
  Boolean(redis) && !FORCE_FILE_STORAGE && Date.now() >= redisDisabledUntil;

const handleRedisFailure = (error: unknown): void => {
  if (!isRedisQuotaError(error)) {
    return;
  }
  redisDisabledUntil = Date.now() + Math.max(60_000, REDIS_COOLDOWN_MS);
};

const deletePurgeAt = (base: string): string => {
  const date = new Date(base);
  date.setDate(date.getDate() + DELETE_RETENTION_DAYS);
  return date.toISOString();
};

const purgeExpiredDeleted = (store: ContentVaultStore): boolean => {
  const now = Date.now();
  const before = store.items.length;
  store.items = store.items.filter((item) => {
    if (!item.deletedAt) {
      return true;
    }
    const ref = item.deletePurgeAt || item.deletedAt;
    const purgeTime = new Date(ref).getTime();
    if (Number.isNaN(purgeTime)) {
      return true;
    }
    return purgeTime > now;
  });
  return before !== store.items.length;
};

const clampStoreSize = (store: ContentVaultStore): void => {
  if (store.items.length <= MAX_ITEMS) {
    return;
  }
  store.items = [...store.items]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_ITEMS);
};

export const getContentVaultStorageBackend = (): "redis" | "file" =>
  canUseRedis() ? "redis" : "file";

async function readStoreFromRedis(): Promise<ContentVaultStore> {
  if (!redis) {
    return createDefaultStore();
  }
  const raw = await redis.get<ContentVaultStore>(REDIS_STORE_KEY);
  return normalizeStore(raw);
}

async function readStoreFromFile(): Promise<ContentVaultStore> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const store = normalizeStore(JSON.parse(raw));
    return store;
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
      memoryStore = cloneStore(fresh);
      return fresh;
    }
    if (isReadonlyFsError(error) && memoryStore) {
      return cloneStore(memoryStore);
    }
    if (isReadonlyFsError(error)) {
      return createDefaultStore();
    }
    throw error;
  }
}

async function readStore(): Promise<ContentVaultStore> {
  if (canUseRedis()) {
    try {
      const store = await readStoreFromRedis();
      memoryStore = cloneStore(store);
      return store;
    } catch (error) {
      handleRedisFailure(error);
      if (memoryStore) {
        return cloneStore(memoryStore);
      }
    }
  }
  if (memoryStore) {
    return cloneStore(memoryStore);
  }
  const store = await readStoreFromFile();
  memoryStore = cloneStore(store);
  return store;
}

async function writeStore(store: ContentVaultStore): Promise<void> {
  memoryStore = cloneStore(store);
  if (canUseRedis()) {
    try {
      await redis?.set(REDIS_STORE_KEY, store);
      return;
    } catch (error) {
      handleRedisFailure(error);
    }
  }
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    if (isReadonlyFsError(error)) {
      return;
    }
    throw error;
  }
}

export async function listContentVaultItems(
  options: ListContentVaultOptions,
): Promise<ContentVaultItem[]> {
  const userId = normalizeUserId(options.userId);
  if (!userId) {
    throw new Error("userId is required.");
  }
  const store = await readStore();
  let changed = purgeExpiredDeleted(store);
  clampStoreSize(store);
  if (changed) {
    await writeStore(store);
  }
  const includeArchived = Boolean(options.includeArchived);
  const includeDeleted = Boolean(options.includeDeleted);
  const limit = Math.max(1, Math.min(300, Number(options.limit || 40)));
  return store.items
    .filter((item) => item.userId === userId)
    .filter((item) => (options.kind ? item.kind === options.kind : true))
    .filter((item) => (includeArchived ? true : !item.archivedAt))
    .filter((item) => (includeDeleted ? true : !item.deletedAt))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}

export async function saveContentVaultItem(input: SaveContentVaultInput): Promise<ContentVaultItem> {
  const userId = normalizeUserId(input.userId);
  if (!userId) {
    throw new Error("userId is required.");
  }
  const title = input.title.trim();
  if (!title) {
    throw new Error("title is required.");
  }
  const now = nowIso();
  const store = await readStore();
  purgeExpiredDeleted(store);

  const byIdIndex = input.id
    ? store.items.findIndex((item) => item.id === input.id && item.userId === userId)
    : -1;
  const byKeyIndex =
    byIdIndex >= 0 || !input.upsertKey
      ? -1
      : store.items.findIndex(
          (item) =>
            item.userId === userId &&
            item.kind === input.kind &&
            item.upsertKey &&
            item.upsertKey === input.upsertKey,
        );
  const index = byIdIndex >= 0 ? byIdIndex : byKeyIndex;

  if (index >= 0) {
    const current = store.items[index];
    const next: ContentVaultItem = {
      ...current,
      title,
      kind: input.kind,
      summary: input.summary?.trim() || "",
      payload: input.payload,
      upsertKey: input.upsertKey?.trim() || current.upsertKey,
      updatedAt: now,
      deletedAt: undefined,
      deletePurgeAt: undefined,
    };
    store.items[index] = next;
    clampStoreSize(store);
    await writeStore(store);
    return next;
  }

  const created: ContentVaultItem = {
    id: `vault_${crypto.randomUUID()}`,
    userId,
    kind: input.kind,
    title,
    summary: input.summary?.trim() || "",
    payload: input.payload,
    upsertKey: input.upsertKey?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  store.items.unshift(created);
  clampStoreSize(store);
  await writeStore(store);
  return created;
}

export async function deleteContentVaultItem(userIdRaw: string, itemId: string): Promise<boolean> {
  const userId = normalizeUserId(userIdRaw);
  if (!userId || !itemId.trim()) {
    return false;
  }
  const store = await readStore();
  const index = store.items.findIndex((item) => item.userId === userId && item.id === itemId.trim());
  if (index < 0) {
    return false;
  }
  const deletedAt = nowIso();
  store.items[index] = {
    ...store.items[index],
    deletedAt,
    deletePurgeAt: deletePurgeAt(deletedAt),
    updatedAt: deletedAt,
  };
  await writeStore(store);
  return true;
}
