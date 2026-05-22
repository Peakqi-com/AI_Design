"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { CREDIT_COSTS, formatCredits } from "@/lib/credits/store";

/* ================================================================
   Global modals for credits:
   - showInsufficientCredits() — pops up when tryDeduct fails (HTTP 402)
   - confirmCost(label, action, qty) — asks user to confirm before AI op
   ================================================================ */

interface ConfirmState {
  open: boolean;
  label: string;
  unitCost: number;
  quantity: number;
  totalCost: number;
  resolve: (ok: boolean) => void;
}

interface CreditsModalContextValue {
  showInsufficientCredits: (message?: string) => void;
  confirmCost: (label: string, action: string, quantity?: number) => Promise<boolean>;
}

const CreditsModalContext = createContext<CreditsModalContextValue | null>(null);

export const useCreditsModal = (): CreditsModalContextValue | null => {
  return useContext(CreditsModalContext);
};

interface ProviderProps {
  children: React.ReactNode;
  onUpgrade?: () => void;
  isLoggedIn?: boolean;
  onSignUp?: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const CreditsModalProvider: React.FC<ProviderProps> = ({
  children,
  onUpgrade,
  onSignUp,
  isLoggedIn = true,
}) => {
  /* ---- insufficient credits popup ---- */
  const [insufficientOpen, setInsufficientOpen] = useState(false);
  const [insufficientMsg, setInsufficientMsg] = useState<string>("點數不足");

  const showInsufficientCredits = useCallback((msg?: string) => {
    setInsufficientMsg(msg || "點數不足，請加購或升級方案後繼續使用。");
    setInsufficientOpen(true);
  }, []);

  /* ---- confirm-cost dialog ---- */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const confirmCost = useCallback(
    (label: string, action: string, quantity: number = 1): Promise<boolean> => {
      const unitCost = CREDIT_COSTS[action] ?? 0.55;
      const qty = Math.max(1, Math.floor(quantity));
      const totalCost = round2(unitCost * qty);
      return new Promise<boolean>((resolve) => {
        setConfirmState({ open: true, label, unitCost, quantity: qty, totalCost, resolve });
      });
    },
    [],
  );

  const closeConfirm = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };

  return (
    <CreditsModalContext.Provider value={{ showInsufficientCredits, confirmCost }}>
      {children}

      {/* === Insufficient Credits Popup === */}
      {insufficientOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 px-6 py-5 border-b border-amber-100">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-2xl">
                  ⚡
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">點數不足</h3>
                  <p className="text-xs text-gray-500 mt-0.5">無法繼續執行 AI 生成</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-700 leading-relaxed">{insufficientMsg}</p>
              <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-1">
                <p>· 圖片生成：每張 0.55 點</p>
                <p>· 文字生成：每則 0.15 點</p>
                <p>· 影片生成：每部 12.5 點</p>
              </div>
            </div>
            <div className="px-6 pb-5 flex flex-col gap-2">
              {isLoggedIn ? (
                <button
                  onClick={() => {
                    setInsufficientOpen(false);
                    onUpgrade?.();
                  }}
                  className="w-full py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-lg text-sm font-semibold hover:from-brand-600 hover:to-brand-700 transition-colors shadow-sm"
                >
                  升級方案 / 加購點數
                </button>
              ) : (
                <button
                  onClick={() => {
                    setInsufficientOpen(false);
                    onSignUp?.();
                  }}
                  className="w-full py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-lg text-sm font-semibold hover:from-brand-600 hover:to-brand-700 transition-colors shadow-sm"
                >
                  立即加入會員
                </button>
              )}
              <button
                onClick={() => setInsufficientOpen(false)}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                稍後再說
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Confirm Cost Dialog === */}
      {confirmState?.open && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="bg-gradient-to-br from-brand-50 to-blue-50 px-6 py-4 border-b border-brand-100">
              <h3 className="text-base font-bold text-gray-900">確認執行</h3>
              <p className="text-xs text-gray-500 mt-0.5">{confirmState.label}</p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">單價</span>
                <span className="font-mono text-gray-900">{formatCredits(confirmState.unitCost)} 點</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">數量</span>
                <span className="font-mono text-gray-900">× {confirmState.quantity}</span>
              </div>
              <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">本次扣點</span>
                <span className="text-lg font-bold text-brand-600 font-mono">{formatCredits(confirmState.totalCost)} 點</span>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-2">
              <button
                onClick={() => closeConfirm(false)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => closeConfirm(true)}
                className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors"
              >
                確認生成
              </button>
            </div>
          </div>
        </div>
      )}
    </CreditsModalContext.Provider>
  );
};
