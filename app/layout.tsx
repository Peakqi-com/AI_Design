import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AI Wedding Pro | 婚慶產業 AI 營運平台",
  description:
    "AI Wedding Pro 是婚慶產業的一站式 AI 平台，整合禮服試穿、社群發文與短影音生成、CRM 與專案管理。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="bg-gray-50 text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
