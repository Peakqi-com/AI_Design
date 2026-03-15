const STORAGE_KEY = "aiwedding:user-scope-id";

const sanitizeUserScope = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

const randomSuffix = (): string =>
  Math.random()
    .toString(36)
    .slice(2, 10);

export const resolveClientUserScopeId = (
  sessionUserId?: string | null,
  sessionEmail?: string | null,
): string => {
  const sessionScoped = sanitizeUserScope(sessionUserId || "");
  if (sessionScoped) {
    return `auth_${sessionScoped}`;
  }

  const fallbackFromEmail = sanitizeUserScope((sessionEmail || "").toLowerCase());
  if (fallbackFromEmail) {
    return `auth_${fallbackFromEmail}`;
  }

  if (typeof window === "undefined") {
    return "guest_server";
  }

  const existing = sanitizeUserScope(window.localStorage.getItem(STORAGE_KEY) || "");
  if (existing) {
    return existing;
  }

  const generated = `guest_${randomSuffix()}`;
  window.localStorage.setItem(STORAGE_KEY, generated);
  return generated;
};
