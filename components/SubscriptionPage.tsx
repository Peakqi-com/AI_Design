import React from 'react';
import { Button } from './Button';
import { Check, Star, Zap, Crown } from 'lucide-react';
import { PricingPlan } from '../types';

export const SubscriptionPage: React.FC = () => {
  const plans: PricingPlan[] = [
    {
      id: 'starter-credits',
      type: 'credits',
      title: '標準點數包',
      price: 'NT$ 2,500',
      description: '適合小型團隊與短週期專案，按需啟用 AI 產能。',
      features: [
        '800 點 AI 算力點數',
        '單張 AI 空間渲染圖約消耗 2-5 點',
        '可用於渲染、細節修復與影音生成',
        '基礎室內專案管理',
        '無月費負擔'
      ],
      buttonText: '購買點數'
    },
    {
      id: 'pro-credits',
      type: 'credits',
      title: '進階點數包',
      price: 'NT$ 6,600',
      description: '適合高頻提案與多人協作，單點成本更低。',
      features: [
        '2400 點 AI 算力點數',
        '可用於渲染、細節修復與影音生成',
        '全功能 AI 裝修報價系統',
        '社群自動化發文 (IG/FB)',
        '優先客服支援'
      ],
      recommended: true,
      buttonText: '選擇進階方案'
    },
    {
      id: 'custom',
      type: 'subscription',
      title: '客製化方案',
      price: '客製報價',
      description: '適合連鎖品牌、大型團隊與跨部門導入。',
      features: [
        '依團隊規模與流程客製點數與權限',
        '專屬導入顧問與教育訓練',
        '進階 API / 流程整合支援',
        '專屬 SLA 與長期合作方案'
      ],
      buttonText: '聯繫銷售團隊',
    }
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-gray-900">選擇最適合您的成長方案</h2>
        <p className="mt-4 text-gray-500">無論是新創設計團隊或成熟室內品牌，都能用 AI 提升產能與轉換率。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {plans.map((plan) => (
          <div 
            key={plan.id}
            className={`relative bg-white rounded-2xl shadow-sm border p-8 flex flex-col ${
              plan.recommended 
                ? 'border-brand-500 ring-2 ring-brand-500 ring-opacity-50 shadow-lg' 
                : 'border-gray-200 hover:border-brand-200'
            }`}
          >
            {plan.recommended && (
              <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4">
                <span className="inline-flex items-center gap-1 bg-brand-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                  <Star className="w-3 h-3 fill-current" /> 熱門選擇
                </span>
              </div>
            )}
            
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                {plan.type === 'credits' && <Zap className="w-6 h-6 text-yellow-500" />}
                {plan.type === 'subscription' && <Crown className="w-6 h-6 text-brand-500" />}
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
                    <Check className={`w-5 h-5 flex-shrink-0 ${plan.type === 'course' ? 'text-purple-500' : 'text-green-500'}`} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Button 
              variant={plan.recommended ? 'primary' : 'outline'}
              fullWidth
            >
              {plan.buttonText}
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-12 bg-gray-50 rounded-xl p-6 text-center text-sm text-gray-500">
        <p>需要跨品牌、跨據點或 API 串接？<a href="#" className="text-brand-600 font-medium hover:underline">聯繫我們的銷售團隊</a> 取得客製化導入建議與正式報價。</p>
      </div>
    </div>
  );
};