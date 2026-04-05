import React from 'react';
import { Button } from './Button';
import { Check, Star, Zap, GraduationCap, Crown } from 'lucide-react';
import { PricingPlan } from '../types';

export const SubscriptionPage: React.FC = () => {
  const plans: PricingPlan[] = [
    {
      id: 'free',
      title: '免費體驗版',
      price: 'NT$ 0',
      description: '適合初次體驗 AI 室內設計功能',
      features: ['AI 空間渲染', '多視角輸出（8 種）', '媒體庫', '簡報製作', '30 點免費算力'],
      type: 'subscription',
      buttonText: '目前方案',
    },
    {
      id: 'pro',
      title: '專業版',
      price: 'NT$ 2,500',
      period: '/ 月',
      description: '適合個人設計師與小型工作室',
      features: ['800 點 / 月', 'AI 空間渲染', '多視角輸出', '媒體庫', '簡報製作', '社群發文中心', 'AI 裝修報價', '優先算力'],
      recommended: true,
      type: 'subscription',
      buttonText: '升級專業版',
    },
    {
      id: 'business',
      title: '商務版',
      price: 'NT$ 6,600',
      period: '/ 月',
      description: '適合設計公司與團隊協作',
      features: ['2,400 點 / 月', '所有專業版功能', '客戶關係 CRM', '專案管理', '優先算力', '專屬客服支援'],
      type: 'subscription',
      buttonText: '升級商務版',
    },
    {
      id: 'enterprise',
      title: '企業版',
      price: '聯繫業務',
      description: '適合大型企業與連鎖品牌',
      features: ['全客製化功能', '無限點數', 'API 存取', '專屬部署', 'SLA 服務保證', '專屬客戶成功經理'],
      type: 'subscription',
      buttonText: '聯繫我們',
    },
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