import { getServerSession } from "next-auth";
import { authConfig } from "@/lib/auth";

const sanitizeUserScope = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

const buildAuthUserScope = (sessionUser?: { id?: string; email?: string | null } | null): string => {
  const idBased = sanitizeUserScope(sessionUser?.id || "");
  if (idBased) {
    return `auth_${idBased}`;
  }
  const emailBased = sanitizeUserScope(String(sessionUser?.email || "").toLowerCase());
  if (emailBased) {
    return `auth_${emailBased}`;
  }
  return "";
};

export const resolveServerUserScopeCandidates = async (
  requestedUserId?: string,
): Promise<string[]> => {
  const session = await getServerSession(authConfig);
  const sessionUser = (session?.user || null) as { id?: string; email?: string | null } | null;
  const authScope = buildAuthUserScope(sessionUser);
  const requestedScope = sanitizeUserScope(requestedUserId || "");

  const candidates: string[] = [];
  if (authScope) {
    candidates.push(authScope);
  }
  if (requestedScope && !candidates.includes(requestedScope)) {
    candidates.push(requestedScope);
  }
  if (candidates.length === 0) {
    candidates.push("guest_server");
  }
  return candidates;
};

export const resolveServerUserScopeId = async (requestedUserId?: string): Promise<string> => {
  const [first] = await resolveServerUserScopeCandidates(requestedUserId);
  return first || "guest_server";
};
