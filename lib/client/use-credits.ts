/**
 * Client-side credits hook — check balance, deduct before AI calls, refresh after.
 */

import { useCallback, useEffect, useState } from "react";
import { resolveClientUserScopeId } from "./user-scope";
import { useSession } from "next-auth/react";
import { useCreditsModal } from "./credits-modal-context";

export interface CreditState {
  credits: number;
  plan: string;
  totalUsed: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  loading: boolean;
  isAdmin: boolean;
}

export function useCredits() {
  const { data: session } = useSession();
  const modal = useCreditsModal();
  const [state, setState] = useState<CreditState>({
    credits: 0,
    plan: "free",
    totalUsed: 0,
    storageUsedBytes: 0,
    storageQuotaBytes: 50 * 1024 * 1024,
    loading: true,
    isAdmin: false,
  });

  const sessionUser = session?.user as { id?: string; email?: string | null; name?: string | null; image?: string | null } | undefined;
  const userScopeId = resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null);
  const userEmail = sessionUser?.email || "";
  const userName = sessionUser?.name || "";
  const userAvatar = sessionUser?.image || "";

  const refresh = useCallback(async () => {
    if (!userScopeId) return;
    try {
      const params = new URLSearchParams({ userId: userScopeId });
      if (userEmail) params.set("email", userEmail);
      if (userName) params.set("name", userName);
      if (userAvatar) params.set("avatar", userAvatar);
      const res = await fetch(`/api/credits?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setState({
        credits: data.credits ?? 0,
        plan: data.plan ?? "free",
        totalUsed: data.totalUsed ?? 0,
        storageUsedBytes: data.storageUsedBytes ?? 0,
        storageQuotaBytes: data.storageQuotaBytes ?? 50 * 1024 * 1024,
        loading: false,
        isAdmin: data.isAdmin ?? false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [userScopeId, userEmail, userName, userAvatar]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Try to deduct credits for an action.
   * @param quantity How many units to deduct (e.g. 8 for 8 viewpoints, N for N slides). Default 1.
   */
  const tryDeduct = useCallback(
    async (action: string, quantity: number = 1): Promise<{ ok: boolean; remaining: number; cost?: number; error?: string }> => {
      try {
        const res = await fetch("/api/credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userScopeId, action, quantity }),
        });
        const data = await res.json();
        if (!res.ok) {
          // 402 = 點數不足 — 顯示全域 popup
          if (res.status === 402 && modal) {
            modal.showInsufficientCredits(data.error);
          }
          return { ok: false, remaining: data.remaining ?? state.credits, error: data.error };
        }
        setState((prev) => ({ ...prev, credits: data.remaining }));
        return { ok: true, remaining: data.remaining, cost: data.cost };
      } catch {
        return { ok: false, remaining: state.credits, error: "扣點失敗，請重試" };
      }
    },
    [userScopeId, state.credits, modal],
  );

  return {
    ...state,
    userScopeId,
    userEmail,
    refresh,
    tryDeduct,
  };
}
