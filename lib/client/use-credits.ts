/**
 * Client-side credits hook — check balance, deduct before AI calls, refresh after.
 */

import { useCallback, useEffect, useState } from "react";
import { resolveClientUserScopeId } from "./user-scope";
import { useSession } from "next-auth/react";

export interface CreditState {
  credits: number;
  plan: string;
  totalUsed: number;
  loading: boolean;
  isAdmin: boolean;
}

export function useCredits() {
  const { data: session } = useSession();
  const [state, setState] = useState<CreditState>({
    credits: 0,
    plan: "free",
    totalUsed: 0,
    loading: true,
    isAdmin: false,
  });

  const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
  const userScopeId = resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null);
  const userEmail = sessionUser?.email || "";

  const refresh = useCallback(async () => {
    if (!userScopeId) return;
    try {
      const res = await fetch(`/api/credits?userId=${encodeURIComponent(userScopeId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setState({
        credits: data.credits ?? 0,
        plan: data.plan ?? "free",
        totalUsed: data.totalUsed ?? 0,
        loading: false,
        isAdmin: data.isAdmin ?? false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [userScopeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Try to deduct credits for an action.
   * Returns { ok: true, remaining } on success, { ok: false, error } on failure.
   */
  const tryDeduct = useCallback(
    async (action: string): Promise<{ ok: boolean; remaining: number; error?: string }> => {
      try {
        const res = await fetch("/api/credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userScopeId, action }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, remaining: data.remaining ?? state.credits, error: data.error };
        }
        setState((prev) => ({ ...prev, credits: data.remaining }));
        return { ok: true, remaining: data.remaining };
      } catch {
        return { ok: false, remaining: state.credits, error: "扣點失敗，請重試" };
      }
    },
    [userScopeId, state.credits],
  );

  return {
    ...state,
    userScopeId,
    userEmail,
    refresh,
    tryDeduct,
  };
}
