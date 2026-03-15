import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AI Interior Pro | 室內設計產業 AI 營運平台",
  description:
    "AI Interior Pro 是室內設計產業的一站式 AI 平台，整合空間渲染、社群發文與短影音生成、CRM 與專案管理。",
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
