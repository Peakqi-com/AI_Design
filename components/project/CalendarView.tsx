/**
 * CalendarView — a real month-grid calendar showing workflow tasks across the
 * days they span (start date + durationDays). Multiple months render stacked.
 */

import React from "react";
import { ProjectWorkflowTask } from "../../types";

const STAGE_COLORS: Record<string, string> = {
  保護: "#64748b", 拆除: "#ef4444", 水電: "#3b82f6", 泥作: "#f59e0b",
  防水: "#06b6d4", 木作: "#8b5cf6", 系統櫃: "#a855f7", 油漆: "#ec4899",
  地板: "#10b981", 廚衛: "#0ea5e9", 空調: "#14b8a6", 收尾: "#22c55e", 清潔: "#84cc16",
};
const colorForStage = (stage?: string): string => {
  if (!stage) return "#6366f1";
  const hit = Object.keys(STAGE_COLORS).find((k) => stage.includes(k));
  return hit ? STAGE_COLORS[hit] : "#6366f1";
};

const parseDate = (s?: string): Date | null => {
  if (!s) return null;
  const d = new Date(s + (s.length <= 10 ? "T00:00:00" : ""));
  return Number.isNaN(d.getTime()) ? null : d;
};
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

export interface CalendarViewProps {
  tasks: ProjectWorkflowTask[];
  fallbackDate?: string;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ tasks, fallbackDate }) => {
  // Expand each task into the set of dates it covers
  const dayMap = new Map<string, Array<{ title: string; stage?: string; done?: boolean }>>();
  let minD: Date | null = null;
  let maxD: Date | null = null;

  for (const t of tasks) {
    const start = parseDate(t.date) || parseDate(fallbackDate);
    if (!start) continue;
    const dur = Math.max(1, Number(t.durationDays) || 1);
    for (let i = 0; i < dur; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = ymd(d);
      const arr = dayMap.get(key) || [];
      arr.push({ title: t.title, stage: t.stage, done: t.done });
      dayMap.set(key, arr);
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    }
  }

  if (!minD || !maxD) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-sm">尚無可顯示的工項（需要日期）</p>
        <p className="text-xs mt-1">在編輯模式為工項設定開始日期與工期天數</p>
      </div>
    );
  }

  // Build list of months to render (from minD's month to maxD's month)
  const months: Date[] = [];
  const cursor = new Date(minD.getFullYear(), minD.getMonth(), 1);
  const lastMonth = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
  while (cursor <= lastMonth) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div className="space-y-6">
      {months.map((m) => {
        const year = m.getFullYear();
        const mon = m.getMonth();
        const firstDay = new Date(year, mon, 1).getDay();
        const daysInMonth = new Date(year, mon + 1, 0).getDate();
        // build 6x7 grid cells
        const cells: Array<Date | null> = [];
        for (let i = 0; i < firstDay; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, mon, d));
        while (cells.length % 7 !== 0) cells.push(null);

        return (
          <div key={monthKey(m)} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 font-semibold text-gray-800 text-sm">
              {year} 年 {mon + 1} 月
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] text-gray-400 border-b border-gray-100">
              {weekLabels.map((w, i) => (
                <div key={w} className={`py-1.5 ${i === 0 || i === 6 ? "text-gray-300" : ""}`}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((cell, idx) => {
                if (!cell) return <div key={idx} className="min-h-[88px] border-b border-r border-gray-50 bg-gray-50/40" />;
                const key = ymd(cell);
                const items = dayMap.get(key) || [];
                const weekend = cell.getDay() === 0 || cell.getDay() === 6;
                return (
                  <div
                    key={idx}
                    className={`min-h-[88px] border-b border-r border-gray-50 p-1 ${weekend ? "bg-gray-50/40" : ""}`}
                  >
                    <div className={`text-[11px] mb-1 ${weekend ? "text-gray-300" : "text-gray-500"}`}>{cell.getDate()}</div>
                    <div className="space-y-0.5">
                      {items.slice(0, 3).map((it, i) => (
                        <div
                          key={i}
                          className="text-[10px] leading-tight px-1 py-0.5 rounded text-white truncate"
                          style={{ background: it.done ? "#cbd5e1" : colorForStage(it.stage) }}
                          title={it.title}
                        >
                          {it.title}
                        </div>
                      ))}
                      {items.length > 3 && (
                        <div className="text-[10px] text-gray-400 px-1">+{items.length - 3}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
