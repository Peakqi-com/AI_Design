import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { Redis } from "@upstash/redis";

export type SocialAssetKind = "image" | "video";
export type SocialAssetOrigin =
  | "video-studio"
  | "marketing-image-generator"
  | "manual-upload"
  | "ai-studio";

interface SocialAssetStorageFile {
  kind: "file";
  relativePath: string;
}

interface SocialAssetStorageInline {
  kind: "inline_base64";
  base64Data: string;
}

interface SocialAssetStorageMissing {
  kind: "missing";
}

interface SocialAssetStorageRedis {
  kind: "redis_base64";
  redisKey: string;
}

type SocialAssetStorage =
  | SocialAssetStorageFile
  | SocialAssetStorageInline
  | SocialAssetStorageMissing
  | SocialAssetStorageRedis;

export interface SocialAssetMeta {
  origin?: SocialAssetOrigin;
  mode?: string;
  style?: string;
  aspectRatio?: string;
  sourceType?: string;
  durationSec?: number;
  prompt?: string;
  summary?: string;
  roomType?: string;
  dressName?: string;
  model?: string;
}

interface SocialAssetRecord {
  id: string;
  userId: string;
  kind: SocialAssetKind;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  deletedAt?: string; // soft-delete timestamp; undefined = active
  meta: SocialAssetMeta;
  storage: SocialAssetStorage;
}

interface SocialAssetStore {
  version: number;
  items: SocialAssetRecord[];
}

export interface SocialAssetItem {
  id: string;
  userId: string;
  kind: SocialAssetKind;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  deletedAt?: string;
  url: string;
  meta: SocialAssetMeta;
}

export interface SaveSocialAssetInput {
  userId: string;
  kind: SocialAssetKind;
  buffer: Buffer;
  fileName?: string;
  mimeType?: string;
  meta?: SocialAssetMeta;
}

const STORE_VERSION = 1;
const MAX_ASSETS_TOTAL = 500;
const INLINE_FALLBACK_MAX_BYTES = 3 * 1024 * 1024;
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_STORE_KEY = process.env.SOCIAL_ASSET_REDIS_KEY || "social:assets:store:v2";
const REDIS_DATA_KEY_PREFIX = process.env.SOCIAL_ASSET_REDIS_DATA_PREFIX || "social:assets:data:v2:";
const FORCE_FILE_STORAGE = /^(1|true|yes)$/i.test(process.env.SOCIAL_ASSET_FORCE_FILE_STORAGE || "");
const REDIS_COOLDOWN_MS = Number(process.env.SOCIAL_ASSET_REDIS_COOLDOWN_MS || 30 * 60 * 1000);
const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;
const DATA_DIR =
  process.env.SOCIAL_ASSET_DATA_DIR ||
  (process.env.VERCEL ? "/tmp/aiinterior-social-assets" : path.join(process.cwd(), ".data"));
const ASSET_DIR = path.join(DATA_DIR, "social-assets");
const STORE_FILE = path.join(DATA_DIR, "social-asset-store.json");

let memoryStore: SocialAssetStore | null = null;
let redisDisabledUntil = 0;

const mimeExtensionMap: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

const sanitizeId = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

const sanitizeName = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);

const ensureMimeType = (mimeType: string | undefined, kind: SocialAssetKind): string => {
  const normalized = (mimeType || "").trim().toLowerCase();
  if (kind === "image") {
    return normalized.startsWith("image/") ? normalized : "image/jpeg";
  }
  return normalized.startsWith("video/") ? normalized : "video/mp4";
};

const guessExtension = (mimeType: string, fileName?: string): string => {
  if (fileName) {
    const ext = path.extname(fileName);
    if (ext) {
      return ext;
    }
  }
  return mimeExtensionMap[mimeType] ?? (mimeType.startsWith("image/") ? ".jpg" : ".mp4");
};

const formatAssetDateTag = (iso: string): string => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const ensureDateName = (baseName: string, dateTag: string): string =>
  /\d{8}[-_]?\d{6}/.test(baseName) ? baseName : `${baseName}_${dateTag}`;

const createDefaultStore = (): SocialAssetStore => ({
  version: STORE_VERSION,
  items: [],
});

const cloneStore = (store: SocialAssetStore): SocialAssetStore => structuredClone(store);

const isReadonlyFsError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /EROFS|EACCES|EPERM/i.test(error.message);
};

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

const normalizeStore = (raw: unknown): SocialAssetStore => {
  if (!raw || typeof raw !== "object") {
    return createDefaultStore();
  }
  const maybe = raw as Partial<SocialAssetStore>;
  return {
    version: STORE_VERSION,
    items: Array.isArray(maybe.items) ? maybe.items : [],
  };
};

const normalizeUserId = (input: string): string => {
  const normalized = sanitizeId(input);
  if (!normalized) {
    throw new Error("userId is required.");
  }
  return normalized;
};

const toClientItem = (record: SocialAssetRecord): SocialAssetItem => ({
  id: record.id,
  userId: record.userId,
  kind: record.kind,
  fileName: record.fileName,
  mimeType: record.mimeType,
  size: record.size,
  createdAt: record.createdAt,
  deletedAt: record.deletedAt,
  url: `/api/social/assets/${record.id}/file?userId=${encodeURIComponent(record.userId)}`,
  meta: record.meta || {},
});

export const getSocialAssetStorageBackend = (): "redis" | "file" => (canUseRedis() ? "redis" : "file");

async function readStoreFromRedis(): Promise<SocialAssetStore> {
  if (!redis) {
    return createDefaultStore();
  }
  const raw = await redis.get<SocialAssetStore>(REDIS_STORE_KEY);
  return normalizeStore(raw);
}

async function writeStoreToRedis(store: SocialAssetStore): Promise<void> {
  if (!redis) {
    return;
  }
  await redis.set(REDIS_STORE_KEY, store);
}

const buildRedisDataKey = (assetId: string): string => `${REDIS_DATA_KEY_PREFIX}${assetId}`;

const persistRedisAssetData = async (assetId: string, buffer: Buffer): Promise<string> => {
  if (!redis || !canUseRedis()) {
    throw new Error("Redis is not configured.");
  }
  const dataKey = buildRedisDataKey(assetId);
  const base64Data = buffer.toString("base64");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await redis.set(dataKey, base64Data);
      return dataKey;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
  }
  handleRedisFailure(lastError);
  throw lastError instanceof Error ? lastError : new Error("Redis asset save failed.");
};

async function readStoreFromFile(): Promise<SocialAssetStore> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
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
    if (isReadonlyFsError(error) && memoryStore) {
      return cloneStore(memoryStore);
    }
    if (isReadonlyFsError(error)) {
      return createDefaultStore();
    }
    throw error;
  }
}

async function writeStoreToFile(store: SocialAssetStore): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
    memoryStore = cloneStore(store);
  } catch (error) {
    if (isReadonlyFsError(error)) {
      memoryStore = cloneStore(store);
      return;
    }
    throw error;
  }
}

async function getStore(): Promise<SocialAssetStore> {
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
      return readStoreFromFile();
    }
  }
  if (memoryStore) {
    return cloneStore(memoryStore);
  }
  const store = await readStoreFromFile();
  memoryStore = cloneStore(store);
  return store;
}

async function saveStore(store: SocialAssetStore): Promise<void> {
  if (canUseRedis()) {
    try {
      await writeStoreToRedis(store);
      memoryStore = cloneStore(store);
      return;
    } catch (error) {
      handleRedisFailure(error);
    }
  }
  await writeStoreToFile(store);
}

const makeAssetId = (): string => `asset_${crypto.randomUUID()}`;

const removeAssetFileSafe = async (asset: SocialAssetRecord): Promise<void> => {
  if (asset.storage.kind === "redis_base64") {
    if (!redis) {
      return;
    }
    try {
      await redis.del(asset.storage.redisKey);
    } catch {
      // ignore cleanup failures
    }
    return;
  }
  if (asset.storage.kind !== "file") {
    return;
  }
  try {
    await fs.unlink(path.join(DATA_DIR, asset.storage.relativePath));
  } catch {
    // ignore cleanup failures
  }
};

const persistAssetDataToFileOrInline = async (
  relativePath: string,
  buffer: Buffer,
): Promise<SocialAssetStorage> => {
  try {
    await fs.mkdir(ASSET_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, relativePath), buffer);
    return { kind: "file", relativePath };
  } catch (error) {
    if (!isReadonlyFsError(error)) {
      throw error;
    }
    if (buffer.length <= INLINE_FALLBACK_MAX_BYTES) {
      return { kind: "inline_base64", base64Data: buffer.toString("base64") };
    }
    return { kind: "missing" };
  }
};

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function listSocialAssets(input: {
  userId: string;
  kind?: SocialAssetKind;
  limit?: number;
  trash?: boolean; // true = list trash items only
}): Promise<SocialAssetItem[]> {
  const userId = normalizeUserId(input.userId);
  const store = await getStore();
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 24)));
  const now = Date.now();

  // Auto-purge items that have been in trash > 30 days
  const autoPurged: SocialAssetRecord[] = [];
  store.items = store.items.filter((item) => {
    if (item.deletedAt && now - new Date(item.deletedAt).getTime() > TRASH_TTL_MS) {
      autoPurged.push(item);
      return false;
    }
    return true;
  });
  if (autoPurged.length > 0) {
    await saveStore(store);
    await Promise.all(autoPurged.map((item) => removeAssetFileSafe(item)));
  }

  const filtered = store.items
    .filter((item) => item.userId === userId)
    .filter((item) => (input.trash ? Boolean(item.deletedAt) : !item.deletedAt))
    .filter((item) => (input.kind ? item.kind === input.kind : true))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
  return filtered.map(toClientItem);
}

export async function saveSocialAsset(input: SaveSocialAssetInput): Promise<SocialAssetItem> {
  const userId = normalizeUserId(input.userId);
  const store = await getStore();
  const id = makeAssetId();
  const createdAt = new Date().toISOString();
  const mimeType = ensureMimeType(input.mimeType, input.kind);
  const ext = guessExtension(mimeType, input.fileName);
  const dateTag = formatAssetDateTag(createdAt);
  const rawFileName = (input.fileName || `${input.kind}`).trim();
  const originalExt = path.extname(rawFileName);
  const rawBaseName = rawFileName.replace(originalExt, "") || input.kind;
  const baseName = sanitizeName(ensureDateName(rawBaseName, dateTag));
  const displayName = `${baseName}${ext}`;
  const outputName = `${baseName}_${id}${ext}`;
  const relativePath = path.join("social-assets", outputName);
  let storage: SocialAssetStorage = { kind: "missing" };

  if (canUseRedis()) {
    try {
      const redisKey = await persistRedisAssetData(id, input.buffer);
      storage = { kind: "redis_base64", redisKey };
    } catch (error) {
      handleRedisFailure(error);
      storage = await persistAssetDataToFileOrInline(relativePath, input.buffer);
    }
  } else {
    storage = await persistAssetDataToFileOrInline(relativePath, input.buffer);
  }

  const record: SocialAssetRecord = {
    id,
    userId,
    kind: input.kind,
    fileName: displayName,
    mimeType,
    size: input.buffer.length,
    createdAt,
    meta: input.meta ?? {},
    storage,
  };

  const nextItems = [record, ...store.items].slice(0, MAX_ASSETS_TOTAL);
  const droppedItems = store.items.slice(Math.max(0, MAX_ASSETS_TOTAL - 1));
  store.items = nextItems;
  await saveStore(store);
  await Promise.all(droppedItems.map((item) => removeAssetFileSafe(item)));

  return toClientItem(record);
}

export async function readSocialAssetFile(input: {
  assetId: string;
  userId: string;
}): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const store = await getStore();
  const userId = normalizeUserId(input.userId);
  const record = store.items.find((item) => item.id === input.assetId && item.userId === userId);
  if (!record) {
    return null;
  }

  if (record.storage.kind === "inline_base64") {
    return {
      buffer: Buffer.from(record.storage.base64Data, "base64"),
      mimeType: record.mimeType,
    };
  }

  if (record.storage.kind === "redis_base64") {
    if (!redis) {
      return null;
    }
    try {
      const base64Data = await redis.get<string>(record.storage.redisKey);
      if (!base64Data || typeof base64Data !== "string") {
        return null;
      }
      return {
        buffer: Buffer.from(base64Data, "base64"),
        mimeType: record.mimeType,
      };
    } catch {
      return null;
    }
  }

  if (record.storage.kind === "file") {
    try {
      const buffer = await fs.readFile(path.join(DATA_DIR, record.storage.relativePath));
      return {
        buffer,
        mimeType: record.mimeType,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function softDeleteSocialAsset(input: {
  assetId: string;
  userId: string;
}): Promise<boolean> {
  const userId = normalizeUserId(input.userId);
  const store = await getStore();
  const record = store.items.find((item) => item.id === input.assetId && item.userId === userId && !item.deletedAt);
  if (!record) return false;
  record.deletedAt = new Date().toISOString();
  await saveStore(store);
  return true;
}

export async function restoreSocialAsset(input: {
  assetId: string;
  userId: string;
}): Promise<boolean> {
  const userId = normalizeUserId(input.userId);
  const store = await getStore();
  const record = store.items.find((item) => item.id === input.assetId && item.userId === userId && item.deletedAt);
  if (!record) return false;
  delete record.deletedAt;
  await saveStore(store);
  return true;
}

export async function permanentDeleteSocialAsset(input: {
  assetId: string;
  userId: string;
}): Promise<boolean> {
  const userId = normalizeUserId(input.userId);
  const store = await getStore();
  const idx = store.items.findIndex((item) => item.id === input.assetId && item.userId === userId);
  if (idx === -1) return false;
  const [removed] = store.items.splice(idx, 1);
  await saveStore(store);
  await removeAssetFileSafe(removed);
  return true;
}

export async function emptyTrash(input: { userId: string }): Promise<number> {
  const userId = normalizeUserId(input.userId);
  const store = await getStore();
  const toDelete = store.items.filter((item) => item.userId === userId && item.deletedAt);
  store.items = store.items.filter((item) => !(item.userId === userId && item.deletedAt));
  await saveStore(store);
  await Promise.all(toDelete.map((item) => removeAssetFileSafe(item)));
  return toDelete.length;
}
