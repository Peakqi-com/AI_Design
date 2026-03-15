import React from 'react';
import { Button } from './Button';
import { Check, Star, Zap, GraduationCap, Crown } from 'lucide-react';
import { PricingPlan } from '../types';

export const SubscriptionPage: React.FC = () => {
  const plans: PricingPlan[] = [
    {
      id: 'points',
      type: 'credits',
      title: '靈活點數制',
      price: 'NT$ 2,990',
      description: '適合接案波動較大的設計團隊。無過期限制，隨用隨扣。',
      features: [
        '500 點 AI 算力點數',
        '單張 AI 空間渲染圖約消耗 2-5 點',
        '基礎室內專案管理',
        '無月費負擔',
        '優先客服支援'
      ],
      buttonText: '購買點數'
    },
    {
      id: 'monthly',
      type: 'subscription',
      title: '專業月訂閱',
      price: 'NT$ 1,490',
      period: '/ 月',
      description: '適合穩定接案的室內設計工作室。無限使用基礎功能。',
      features: [
        '每月贈送 1000 點',
        '線稿轉渲染圖無限預覽',
        '全功能 AI 裝修報價系統',
        '社群自動化發文 (IG/FB)',
        '社群短影音腳本生成'
      ],
      recommended: true,
      buttonText: '立即訂閱'
    },
    {
      id: 'course',
      type: 'course',
      title: 'AI 室內設計實戰課程包',
      price: 'NT$ 18,800',
      description: '買課程送一年訂閱！最划算的長期投資選擇。',
      features: [
        '包含「一年份」專業版訂閱 (價值 $17,880)',
        '10 堂 AI 室內設計營運實戰線上課',
        '設計品牌風格模型訓練教學',
        '室內設計產業專屬社群入場券',
        '結業證書'
      ],
      buttonText: '購買課程 + 一年免費',
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
            } ${plan.type === 'course' ? 'bg-gradient-to-b from-purple-50 to-white border-purple-200' : ''}`}
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
              variant={plan.recommended || plan.type === 'course' ? 'primary' : 'outline'}
              fullWidth
              className={plan.type === 'course' ? 'bg-purple-600 hover:bg-purple-700 border-transparent text-white' : ''}
            >
              {plan.buttonText}
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-12 bg-gray-50 rounded-xl p-6 text-center text-sm text-gray-500">
        <p>企業/大型團隊需要客製化方案？<a href="#" className="text-brand-600 font-medium hover:underline">聯繫我們的銷售團隊</a> 了解「免前金分潤授權」模式。</p>
      </div>
    </div>
  );
};