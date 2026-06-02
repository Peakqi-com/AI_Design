/**
 * 標準報價表 — 室內裝修工程的參考單價。
 *
 * 這份是「預設種子」：使用者第一次開啟報價表管理時，會以此初始化到自己的
 * 帳號（存 Redis）。之後使用者可在介面自行增修，AI 歸納報價時讀的是使用者
 * 帳號裡的那份，不是這個檔案。
 *
 * 資料來源：使用者提供之公司標準價（2026）。
 */

import { PricingStandardItem } from "@/lib/crm/types";

export const PRICING_CATEGORIES = [
  "拆除清運",
  "泥作",
  "木作",
  "輕鋼架",
  "水電空調",
  "地坪",
  "保護",
  "設計管理",
  "其他",
] as const;

/** 預設種子（不含 id；seed 時補上）。 */
export const DEFAULT_PRICING_SEED: Omit<PricingStandardItem, "id">[] = [
  { name: "保護工程", unit: "坪", unitPrice: 1200, category: "保護", aliases: ["保護", "地板保護", "全室保護"] },
  { name: "拆除工程", unit: "式", unitPrice: 70000, category: "拆除清運", aliases: ["拆除", "打除", "打牆", "敲除"] },
  { name: "系統櫃", unit: "尺", unitPrice: 8000, category: "木作", aliases: ["系統櫃體", "系統傢俱", "系統家具", "系統衣櫃"] },
  { name: "木作隔間", unit: "尺", unitPrice: 1500, category: "木作", aliases: ["木隔間", "木作牆"] },
  { name: "木作天花板", unit: "坪", unitPrice: 7000, category: "木作", aliases: ["木天花", "木作天花", "天花板木作"] },
  { name: "木作櫃體", unit: "尺", unitPrice: 8000, category: "木作", aliases: ["木作櫃", "木工櫃", "訂製櫃", "木作收納櫃"] },
  { name: "輕鋼架隔間", unit: "平方米", unitPrice: 950, category: "輕鋼架", aliases: ["輕隔間", "輕鋼架牆"] },
  { name: "輕鋼架天花板", unit: "坪", unitPrice: 4500, category: "輕鋼架", aliases: ["輕鋼架天花", "矽酸鈣板天花", "平頂天花"] },
  { name: "水電工程", unit: "式", unitPrice: 160000, category: "水電空調", aliases: ["水電", "水電配置", "管線工程"] },
  { name: "廁所泥作", unit: "間", unitPrice: 22000, category: "泥作", aliases: ["衛浴泥作", "浴室泥作", "廁所泥作工程"] },
  { name: "硬底貼磁磚", unit: "坪", unitPrice: 12000, category: "泥作", aliases: ["硬底磁磚", "硬底貼磚", "硬底"] },
  { name: "軟底貼磁磚", unit: "坪", unitPrice: 8000, category: "泥作", aliases: ["軟底磁磚", "軟底貼磚", "軟底", "貼磁磚", "貼磚"] },
  { name: "木地板", unit: "坪", unitPrice: 7500, category: "地坪", aliases: ["木地板鋪設", "海島型木地板", "超耐磨地板", "地板"] },
  { name: "冷氣(大)(2.5-3噸)", unit: "台", unitPrice: 80000, category: "水電空調", aliases: ["大型冷氣", "大噸數冷氣", "客廳冷氣"] },
  { name: "冷氣(小)(1.5噸以下)", unit: "台", unitPrice: 50000, category: "水電空調", aliases: ["小型冷氣", "小噸數冷氣", "房間冷氣", "分離式冷氣"] },
  { name: "設計費", unit: "坪", unitPrice: 4500, category: "設計管理", aliases: ["設計規劃費", "室內設計費"] },
  { name: "工程管理費", unit: "%", unitPrice: 0, category: "設計管理", aliases: ["監工費", "管理費"], note: "工程總額的 8-10%" },
  { name: "裝潢廢棄物", unit: "車", unitPrice: 18000, category: "拆除清運", aliases: ["廢棄物清運", "垃圾清運", "清運"] },
];

/** 產生給 AI prompt 用的標準報價表文字（精簡、條列）。 */
export const buildPricingReferenceText = (items: Pick<PricingStandardItem, "name" | "unit" | "unitPrice" | "note">[]): string => {
  if (!items || items.length === 0) return "（尚未設定標準報價表）";
  return items
    .map((p) => {
      const price = p.unitPrice > 0 ? `NT$ ${p.unitPrice.toLocaleString()} / ${p.unit}` : p.note || "-";
      return `- ${p.name}（${price}）`;
    })
    .join("\n");
};
