"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

/* ================================================================
   Insufficient Credits Modal — global popup triggered whenever
   tryDeduct() fails. Provides CTAs to upgrade plan / contact sales.
   ================================================================ */

interface CreditsModalContextValue {
  showInsufficientCredits: (message?: string) => void;
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

export const CreditsModalProvider: React.FC<ProviderProps> = ({
  children,
  onUpgrade,
  onSignUp,
  isLoggedIn = true,
}) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string>("點數不足");

  const showInsufficientCredits = useCallback((msg?: string) => {
    setMessage(msg || "點數不足，請加購或升級方案後繼續使用。");
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <CreditsModalContext.Provider value={{ showInsufficientCredits }}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in duration-200">
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
              <p className="text-sm text-gray-700 leading-relaxed">{message}</p>
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
                    close();
                    onUpgrade?.();
                  }}
                  className="w-full py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-lg text-sm font-semibold hover:from-brand-600 hover:to-brand-700 transition-colors shadow-sm"
                >
                  升級方案 / 加購點數
                </button>
              ) : (
                <button
                  onClick={() => {
                    close();
                    onSignUp?.();
                  }}
                  className="w-full py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-lg text-sm font-semibold hover:from-brand-600 hover:to-brand-700 transition-colors shadow-sm"
                >
                  立即加入會員
                </button>
              )}
              <button
                onClick={close}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                稍後再說
              </button>
            </div>
          </div>
        </div>
      )}
    </CreditsModalContext.Provider>
  );
};
