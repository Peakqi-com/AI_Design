import React from 'react';
import { Button } from './Button';
import { Check, Star, Zap, GraduationCap, Crown } from 'lucide-react';
import { PricingPlan } from '../types';

export const SubscriptionPage: React.FC = () => {
  const plans: PricingPlan[] = [
    {
      id: 'starter-800',
      type: 'credits',
      title: '入門方案',
      price: 'NT$ 2,500',
      description: '最低門檻方案，適合剛起步的團隊先快速上線使用。',
      features: [
        '800 點 AI 算力點數',
        '圖片、影片、社群功能可用',
        '基礎室內專案管理',
        '點數用完可再加購',
        '無月費負擔'
      ],
      buttonText: '購買 800 點'
    },
    {
      id: 'pro-2400',
      type: 'credits',
      title: '進階方案',
      price: 'NT$ 6,600',
      description: '高性價比大點數包，適合穩定產出內容與提案的團隊。',
      features: [
        '2400 點 AI 算力點數',
        '平均單點成本更低',
        '支援大量圖片與影片生成',
        '可搭配團隊日常營運流程',
        '優先客服支援'
      ],
      recommended: true,
      buttonText: '購買 2400 點'
    },
    {
      id: 'custom',
      type: 'subscription',
      title: '客製化方案',
      price: '洽詢報價',
      description: '依團隊規模、目標與流程，提供專屬點數與功能配置。',
      features: [
        '專屬點數與權限配置',
        '可加值 API / 私有部署整合',
        '專人導入與教育訓練',
        '企業級合約與服務 SLA',
        '彈性擴充方案'
      ],
      buttonText: '聯繫顧問',
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