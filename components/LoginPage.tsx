import React, { useEffect, useMemo, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { Button } from "./Button";
import { Chrome, ArrowLeft } from "lucide-react";

interface LoginPageProps {
  onLogin: () => void;
  onBack: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin, onBack }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<Record<string, boolean>>({ google: false });

  useEffect(() => {
    let mounted = true;
    const loadProviders = async () => {
      try {
        const providers = await getProviders();
        if (!mounted) {
          return;
        }
        setEnabledProviders({
          google: Boolean(providers?.google),
        });
      } catch {
        if (mounted) {
          setError("無法讀取第三方登入設定，請稍後再試。");
        }
      } finally {
        if (mounted) {
          setProviderReady(true);
        }
      }
    };
    void loadProviders();
    return () => {
      mounted = false;
    };
  }, []);

  const hasAnyOAuthProvider = useMemo(
    () => Object.values(enabledProviders).some(Boolean),
    [enabledProviders],
  );

  const handleOAuthLogin = async (providerId: "google", label: string) => {
    if (!enabledProviders[providerId]) {
      setError(`目前尚未啟用 ${label} OAuth，請先設定對應環境變數。`);
      return;
    }

    setError(null);
    setActiveProvider(providerId);
    setIsLoading(true);
    try {
      const authParams =
        providerId === "google"
          ? { prompt: "select_account", access_type: "offline" }
          : undefined;
      await signIn(providerId, { callbackUrl: "/" }, authParams);
    } catch {
      setError(`${label} 登入失敗，請稍後再試。`);
      setIsLoading(false);
      setActiveProvider(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative">
      <button
        onClick={onBack}
        className="absolute top-8 left-8 text-gray-500 hover:text-gray-900 flex items-center gap-2"
      >
        <ArrowLeft className="w-5 h-5" /> 返回首頁
      </button>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-brand-600 rounded-xl flex items-center justify-center">
             <span className="text-white font-bold text-2xl">Ai</span>
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          登入您的室內設計團隊帳戶
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          開始使用 AI 加速室內設計提案與社群成長
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="space-y-4">
            <Button 
              variant="outline" 
              fullWidth 
              onClick={() => void handleOAuthLogin("google", "Google")}
              disabled={isLoading || !providerReady}
              className="relative"
            >
              <Chrome className="w-5 h-5 absolute left-4 text-gray-500" />
              <span className="ml-2">
                {activeProvider === "google" ? "跳轉 Google 中..." : "使用 Google 帳號登入"}
              </span>
            </Button>
            {providerReady && (
              <p className={`text-[11px] ${enabledProviders.google ? "text-green-700" : "text-amber-700"}`}>
                Google OAuth 狀態：{enabledProviders.google ? "已啟用" : "未啟用（請檢查 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET）"}
              </p>
            )}

            {providerReady && !hasAnyOAuthProvider && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                尚未設定 Google OAuth，請先設定環境變數後再使用。
              </p>
            )}

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};