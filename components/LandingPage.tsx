import React from 'react';
import { Button } from './Button';
import { ArrowRight, Brain, Layout, Palette, Share2, Zap } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  return (
    <div className="bg-white">
      {/* Header */}
      <header className="fixed w-full bg-white/80 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold">Ai</div>
              <span className="font-bold text-xl tracking-tight text-gray-900">Interior Pro</span>
            </div>
            <div className="hidden md:flex space-x-8 text-gray-600 text-sm font-medium">
              <a href="#features" className="hover:text-brand-600">功能特色</a>
              <a href="#solutions" className="hover:text-brand-600">解決方案</a>
              <a href="#pricing" className="hover:text-brand-600">價格方案</a>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onGetStarted}>登入</Button>
              <Button size="sm" onClick={onGetStarted}>免費試用</Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-600 text-sm font-medium mb-6 border border-brand-100">
            <Zap className="w-4 h-4" />
            <span>室內設計產業 AI 全流程營運平台</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-gray-900 tracking-tight mb-6 leading-tight">
            把設計提案效率拉滿<br />
            <span className="text-brand-600">讓 AI 成為設計團隊的第二引擎</span>
          </h1>
          <p className="mt-4 text-xl text-gray-500 max-w-2xl mx-auto mb-10">
            從需求訪談、空間渲染、報價提案到施工流程與社群行銷，一個平台整合室內設計團隊最需要的 AI 能力與 CRM 管理。
          </p>
          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={onGetStarted} className="gap-2">
              立即開始 <ArrowRight className="w-5 h-5" />
            </Button>
            <Button variant="outline" size="lg">觀看演示</Button>
          </div>
        </div>
        
        {/* Abstract Background Image placeholder */}
        <div className="mt-16 relative max-w-5xl mx-auto">
          <div className="aspect-[16/9] bg-gray-100 rounded-2xl overflow-hidden shadow-2xl border border-gray-200">
            <img 
              src="https://picsum.photos/1200/675?grayscale" 
              alt="Platform Dashboard" 
              className="w-full h-full object-cover opacity-90"
            />
            {/* Overlay UI elements to simulate the dashboard look from PDF */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20 p-6 flex items-center justify-center">
              <div className="text-white text-center">
                <Brain className="w-16 h-16 mx-auto mb-4 text-brand-500" />
                <h3 className="text-2xl font-bold shadow-black drop-shadow-md">AI 專案大腦正在運算...</h3>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div id="features" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900">平台核心架構：AI 優先、管理整合</h2>
            <p className="mt-4 text-gray-500">用同一份客戶資料串起渲染、報價、專案與 CRM，降低重工與溝通成本。</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 1: AI Tools */}
            <div className="bg-white rounded-2xl p-8 shadow-sm hover:shadow-md transition-shadow border border-gray-100">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-6">
                <Palette className="w-6 h-6 text-brand-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">AI 空間設計視覺工具</h3>
              <p className="text-gray-500 mb-4">
                AI 線稿轉渲染、空間情境生成、細節增強，讓客戶更快確認風格與方案。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-brand-500"/> 線稿轉渲染</li>
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-brand-500"/> 室內場景視覺生成</li>
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-brand-500"/> 細節修復 + 高清輸出</li>
              </ul>
            </div>

            {/* Card 2: Admin */}
            <div className="bg-white rounded-2xl p-8 shadow-sm hover:shadow-md transition-shadow border border-gray-100">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                <Layout className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">室內專案流程管理</h3>
              <p className="text-gray-500 mb-4">
                以管理整合：CRM、室內專案追蹤、報價與內部註記同步，避免遺漏客戶需求。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"/> LINE CRM 客戶通訊</li>
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"/> 室內專案階段管理</li>
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"/> AI 裝修報價建議</li>
              </ul>
            </div>

            {/* Card 3: Marketing */}
            <div className="bg-white rounded-2xl p-8 shadow-sm hover:shadow-md transition-shadow border border-gray-100">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-6">
                <Share2 className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">社群發文與短影音</h3>
              <p className="text-gray-500 mb-4">
                以社群成長為重點：AI 生成貼文、Hashtags、影片腳本，並輸出可投放短影音素材。
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"/> 社群貼文自動生成</li>
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"/> 社群生成影片腳本</li>
                <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"/> 社群短影音 AI 生成</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gray-900 py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            準備好讓設計團隊火力全開了嗎？
          </h2>
          <p className="text-gray-400 mb-10 max-w-2xl mx-auto">
            用線稿轉渲染、社群發文與社群影片生成，建立你在室內設計市場的高效率獲客引擎。
          </p>
          <Button size="lg" className="bg-brand-600 hover:bg-brand-500 text-white" onClick={onGetStarted}>
            免費註冊帳號
          </Button>
        </div>
      </div>
    </div>
  );
};