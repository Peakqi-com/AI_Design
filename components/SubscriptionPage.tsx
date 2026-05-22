import React from 'react';
import { Button } from './Button';
import { Check, Star, Zap, GraduationCap, Crown, Image as ImageIcon, Film, Type, Plug } from 'lucide-react';
import { PricingPlan } from '../types';

const PAYMENT_URL_PRO = 'https://www.zhizhiplus.com.tw/product/ai-interior-pro-%e5%b0%88%e6%a5%ad%e7%89%88%e6%96%b9%e6%a1%88/';
const PAYMENT_URL_BUSINESS = 'https://www.zhizhiplus.com.tw/product/ai-interior-pro-%e5%95%86%e5%8b%99%e7%89%88%e6%96%b9%e6%a1%88/';
const CONTACT_HREF = 'mailto:ai.allen.task@gmail.com?subject=AI%20Interior%20Pro%20%E6%96%B9%E6%A1%88%E8%A9%A2%E5%95%8F';

export const SubscriptionPage: React.FC = () => {
  const plans: PricingPlan[] = [
    {
      id: 'free',
      title: '10 天免費體驗版',
      price: 'NT$ 0',
      description: '適合初次體驗 AI 室內設計功能',
      features: [
        '50 點體驗（≈ 10 圖片 + 1 影片）',
        'AI 室內設計風格套用',
        'AI 空間渲染',
        'AI 彩色 / 立體平面圖',
        'AI 動畫影片',
        'AI 社群發文中心',
      ],
      type: 'subscription',
      buttonText: '目前方案',
    },
    {
      id: 'pro',
      title: '專業版',
      price: 'NT$ 2,500',
      period: '/ 月（按年計費）',
      description: '適合個人設計師與小型工作室',
      features: [
        '每月 500 點重置（≈ 900 圖片 / 40 影片）',
        'AI 室內設計風格套用、空間渲染',
        'AI 彩色 / 立體 / 立面平面圖',
        'AI 材料說明、簡報製作',
        'AI 動畫影片、社群發文中心',
        '客戶 CRM 系統、媒體庫',
        '作品無浮水印、高清解析度',
      ],
      recommended: true,
      type: 'subscription',
      buttonText: '升級專業版',
      paymentUrl: PAYMENT_URL_PRO,
    },
    {
      id: 'business',
      title: '商務版',
      price: 'NT$ 6,600',
      period: '/ 月（按年計費）',
      description: '適合設計公司與團隊協作',
      features: [
        '每月 1,500 點重置（≈ 2,700 圖片 / 120 影片）',
        '所有專業版功能',
        '圖片畫質增強',
        '優先算力支持',
        '免費行銷文案創作',
        '新功能優先體驗內測',
      ],
      type: 'subscription',
      buttonText: '升級商務版',
      paymentUrl: PAYMENT_URL_BUSINESS,
    },
    {
      id: 'enterprise',
      title: '企業版',
      price: '聯繫客服',
      description: '適合大型企業與連鎖品牌',
      features: [
        '每月客製化點數',
        '所有商務版功能',
        'API 串接存取',
        '客製化企業 AI 功能、專屬部署',
        'SLA 服務保證',
        '專屬客戶客服經理',
      ],
      type: 'subscription',
      buttonText: '聯繫我們',
    },
  ];

  const addons: PricingPlan[] = [
    {
      id: 'credits-pack',
      title: '點數包加購',
      price: 'NT$ 500',
      period: '/ 次',
      description: '適合當月突然大量使用需求（會員加購點數專屬）',
      features: ['100 點數', '≈ 200 張圖 / 10 影片', '一次性加購，會員專用'],
      type: 'addon',
      buttonText: '聯繫我們加購',
    },
    {
      id: 'integration-service',
      title: '串接技術服務加購',
      price: 'NT$ 1,000',
      period: '/ 平台',
      description: '適合行銷排程與 LINE 客服企業用戶',
      features: [
        '遠端協助 Facebook / Instagram / Threads 帳號 API 串接',
        '遠端協助 LINE 官方帳號 API 串接',
        '同時串接 3 個以上平台另有優惠',
        '可全程專人協助串接',
      ],
      type: 'addon',
      buttonText: '聯繫我們',
    },
  ];

  const handleCheckout = (plan: PricingPlan) => {
    if (plan.paymentUrl) {
      window.open(plan.paymentUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (plan.id === 'free') return;
    window.location.href = CONTACT_HREF;
  };

  const renderCard = (plan: PricingPlan) => (
    <div
      key={plan.id}
      className={`relative bg-white rounded-2xl shadow-sm border p-8 flex flex-col ${
        plan.recommended
          ? 'border-brand-500 ring-2 ring-brand-500 ring-opacity-50 shadow-lg'
          : 'border-gray-200 hover:border-brand-200'
      } ${plan.type === 'course' ? 'bg-gradient-to-b from-purple-50 to-white border-purple-200' : ''} ${
        plan.type === 'addon' ? 'bg-gradient-to-b from-amber-50/40 to-white border-amber-200' : ''
      }`}
    >
      {plan.recommended && (
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4">
          <span className="inline-flex items-center gap-1 bg-brand-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
            <Star className="w-3 h-3 fill-current" /> 熱門選擇
          </span>
        </div>
      )}

      {plan.type === 'course' && (
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4">
          <span className="inline-flex items-center gap-1 bg-purple-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
            <GraduationCap className="w-3 h-3" /> 超值優惠
          </span>
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          {plan.type === 'credits' && <Zap className="w-6 h-6 text-yellow-500" />}
          {plan.type === 'subscription' && <Crown className="w-6 h-6 text-brand-500" />}
          {plan.type === 'course' && <GraduationCap className="w-6 h-6 text-purple-600" />}
          {plan.type === 'addon' && <Plug className="w-6 h-6 text-amber-500" />}
          <h3 className="text-xl font-bold text-gray-900">{plan.title}</h3>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-extrabold text-gray-900">{plan.price}</span>
          {plan.period && <span className="text-gray-500 font-medium">{plan.period}</span>}
        </div>
        <p className="mt-2 text-sm text-gray-500 min-h-[40px]">{plan.description}</p>
      </div>

      <div className="flex-1 mb-8">
        <ul className="space-y-4">
          {plan.features.map((feature, idx) => (
            <li key={idx} className="flex items-start gap-3 text-sm text-gray-600">
              <Check
                className={`w-5 h-5 flex-shrink-0 ${
                  plan.type === 'course'
                    ? 'text-purple-500'
                    : plan.type === 'addon'
                      ? 'text-amber-500'
                      : 'text-green-500'
                }`}
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <Button
        variant={plan.recommended || plan.type === 'course' ? 'primary' : 'outline'}
        fullWidth
        className={
          plan.type === 'course'
            ? 'bg-purple-600 hover:bg-purple-700 border-transparent text-white'
            : plan.type === 'addon'
              ? 'bg-amber-500 hover:bg-amber-600 border-transparent text-white'
              : ''
        }
        onClick={() => handleCheckout(plan)}
        disabled={plan.id === 'free'}
      >
        {plan.buttonText}
      </Button>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-gray-900">選擇最適合您的成長方案</h2>
        <p className="mt-4 text-gray-500">無論是新創設計團隊或成熟室內品牌，都能用 AI 提升產能與轉換率。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map(renderCard)}
      </div>

      <div className="mt-12 bg-gray-50 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-500" /> 點數扣抵規則
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-3 bg-white rounded-lg p-4 border border-gray-100">
            <ImageIcon className="w-8 h-8 text-brand-500" />
            <div>
              <div className="font-semibold text-gray-900">圖片生成</div>
              <div className="text-gray-500">每張扣 <span className="font-mono text-brand-600">0.55</span> 點</div>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-white rounded-lg p-4 border border-gray-100">
            <Type className="w-8 h-8 text-emerald-500" />
            <div>
              <div className="font-semibold text-gray-900">文字生成</div>
              <div className="text-gray-500">每則扣 <span className="font-mono text-emerald-600">0.15</span> 點</div>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-white rounded-lg p-4 border border-gray-100">
            <Film className="w-8 h-8 text-purple-500" />
            <div>
              <div className="font-semibold text-gray-900">影片生成</div>
              <div className="text-gray-500">每部扣 <span className="font-mono text-purple-600">12.5</span> 點</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12">
        <h3 className="text-2xl font-bold text-gray-900 text-center mb-2">加購選項</h3>
        <p className="text-center text-gray-500 mb-8">已是會員可額外加購</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {addons.map(renderCard)}
        </div>
      </div>

      <div className="mt-12 bg-gray-50 rounded-xl p-6 text-center text-sm text-gray-500">
        <p>
          企業 / 大型團隊需要客製化方案？
          <a href={CONTACT_HREF} className="text-brand-600 font-medium hover:underline ml-1">
            聯繫我們的銷售團隊
          </a>
          {' '}了解「免前金分潤授權」模式。
        </p>
      </div>
    </div>
  );
};
