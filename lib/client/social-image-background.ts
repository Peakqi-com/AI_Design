export interface BackgroundSocialAssetItem {
  id: string;
  userId: string;
  kind: "image" | "video";
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
  meta?: Record<string, unknown>;
}

export type SocialImageTaskStatus = "running" | "completed" | "failed";

export interface SocialImageBackgroundTask {
  id: string;
  userId: string;
  status: SocialImageTaskStatus;
  prompt: string;
  style: string;
  createdAt: string;
  updatedAt: string;
  imageDataUrl?: string;
  summary?: string;
  model?: string;
  savedAsset?: BackgroundSocialAssetItem;
  error?: string;
}

export interface StartSocialImageTaskInput {
  userId: string;
  prompt: string;
  style: string;
  imageDataUrl: string;
}

interface GenerateResponse {
  imageDataUrl: string;
  summary: string;
  model: string;
  remainingCredits?: number | null;
}

interface SaveAssetResponse {
  item?: BackgroundSocialAssetItem;
}

const tasks = new Map<string, SocialImageBackgroundTask>();
const listeners = new Set<(task: SocialImageBackgroundTask) => void>();

const notify = (task: SocialImageBackgroundTask): void => {
  for (const listener of listeners) {
    listener(task);
  }
};

const requestJson = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
};

const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("無法轉換生成圖片檔案。");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/jpeg" });
};

const toFileDate = (date = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

export const subscribeSocialImageBackgroundTasks = (
  listener: (task: SocialImageBackgroundTask) => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getLatestSocialImageTask = (userId: string): SocialImageBackgroundTask | null => {
  const userTasks = Array.from(tasks.values()).filter((task) => task.userId === userId);
  if (userTasks.length === 0) {
    return null;
  }
  return userTasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
};

export const startSocialImageBackgroundTask = (
  input: StartSocialImageTaskInput,
): SocialImageBackgroundTask => {
  const taskId = `social_img_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const task: SocialImageBackgroundTask = {
    id: taskId,
    userId: input.userId,
    status: "running",
    prompt: input.prompt,
    style: input.style,
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(taskId, task);
  notify(task);

  void (async () => {
    try {
      const generated = await requestJson<GenerateResponse>("/api/ai/social/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: input.userId,
          imageDataUrl: input.imageDataUrl,
          prompt: input.prompt,
          style: input.style,
        }),
      });

      const running: SocialImageBackgroundTask = {
        ...task,
        imageDataUrl: generated.imageDataUrl,
        summary: generated.summary,
        model: generated.model,
        updatedAt: new Date().toISOString(),
      };
      tasks.set(taskId, running);
      notify(running);

      const file = await dataUrlToFile(generated.imageDataUrl, `social-image-${toFileDate()}.jpg`);
      const formData = new FormData();
      formData.append("userId", input.userId);
      formData.append("kind", "image");
      formData.append("file", file);
      formData.append(
        "meta",
        JSON.stringify({
          origin: "marketing-image-generator",
          style: input.style,
          prompt: input.prompt,
          summary: generated.summary,
          model: generated.model,
        }),
      );
      const saved = await requestJson<SaveAssetResponse>("/api/social/assets", {
        method: "POST",
        body: formData,
      });
      if (!saved.item) {
        throw new Error("生成完成但素材庫儲存失敗。");
      }
      const done: SocialImageBackgroundTask = {
        ...running,
        status: "completed",
        savedAsset: saved.item,
        // Keep generated data URL as a local fallback when asset URL is temporarily unreadable.
        imageDataUrl: running.imageDataUrl,
        updatedAt: new Date().toISOString(),
      };
      tasks.set(taskId, done);
      notify(done);
    } catch (error) {
      const failed: SocialImageBackgroundTask = {
        ...task,
        status: "failed",
        error: error instanceof Error ? error.message : "背景生成失敗",
        updatedAt: new Date().toISOString(),
      };
      tasks.set(taskId, failed);
      notify(failed);
    }
  })();

  return task;
};
