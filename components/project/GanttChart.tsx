/**
 * GanttChart — day-based construction schedule visualization.
 *
 * Renders workflow tasks as horizontal bars across a date axis (one column per
 * day). Designed to look clean enough to export as a single PNG/PDF and hand to
 * a client or work crew. Read-only; editing happens in the list editor.
 */

import React from "react";
import { ProjectWorkflowTask } from "../../types";

export const GANTT_W = 1400;

/** Stage → bar color. Falls back to brand color. */
const STAGE_COLORS: Record<string, string> = {
  保護: "#64748b",
  拆除: "#ef4444",
  水電: "#3b82f6",
  泥作: "#f59e0b",
  防水: "#06b6d4",
  木作: "#8b5cf6",
  系統櫃: "#a855f7",
  油漆: "#ec4899",
  地板: "#10b981",
  廚衛: "#0ea5e9",
  空調: "#14b8a6",
  收尾: "#22c55e",
  清潔: "#84cc16",
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

const dayDiff = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / 86400000);

const fmtMD = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}`;

export interface GanttChartProps {
  tasks: ProjectWorkflowTask[];
  projectName?: string;
  /** fallback start date when a task has no date */
  fallbackDate?: string;
  /** true = full export size; false = responsive preview */
  exportMode?: boolean;
}

export const GanttChart: React.FC<GanttChartProps> = ({
  tasks,
  projectName,
  fallbackDate,
  exportMode,
}) => {
  // Resolve each task to start date + duration
  const rows = tasks
    .map((t) => {
      const start = parseDate(t.date) || parseDate(fallbackDate);
      const duration = Math.max(1, Number(t.durationDays) || 1);
      return { task: t, start, duration };
    })
    .filter((r) => r.start)
    .sort((a, b) => a.start!.getTime() - b.start!.getTime());

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-sm">尚無可排程的工項（需要日期）</p>
        <p className="text-xs mt-1">在清單編輯為每個工項設定開始日期與工期天數</p>
      </div>
    );
  }

  // Timeline bounds
  const minStart = new Date(Math.min(...rows.map((r) => r.start!.getTime())));
  const maxEnd = new Date(
    Math.max(...rows.map((r) => r.start!.getTime() + (r.duration - 1) * 86400000)),
  );
  const totalDays = Math.max(1, dayDiff(minStart, maxEnd) + 1);

  // Layout constants
  const labelW = 220;
  const rowH = 46;
  const headerH = 56;
  const dayW = exportMode
    ? Math.max(30, Math.min(64, (GANTT_W - labelW - 40) / totalDays))
    : Math.max(28, Math.min(60, 980 / totalDays));
  const chartW = labelW + totalDays * dayW + 24;
  const chartH = headerH + rows.length * rowH + 24;

  // Day columns (with week shading)
  const days = Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(minStart.getTime() + i * 86400000);
    return { i, d, weekend: d.getDay() === 0 || d.getDay() === 6 };
  });

  return (
    <div
      style={{
        width: chartW,
        minWidth: chartW,
        background: "#ffffff",
        fontFamily: "'Noto Sans TC', system-ui, sans-serif",
        padding: "16px 12px",
        boxSizing: "border-box",
      }}
    >
      {/* Title */}
      <div style={{ paddingLeft: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2937" }}>
          {projectName || "工程進度甘特圖"}
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
          {fmtMD(minStart)} – {fmtMD(maxEnd)}　共 {totalDays} 天 · {rows.length} 個工項
        </div>
        {/* 階段圖例 */}
        {(() => {
          const usedStages = Array.from(
            new Set(rows.map((r) => r.task.stage).filter(Boolean) as string[]),
          ).slice(0, 12);
          if (usedStages.length === 0) return null;
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              {usedStages.map((s) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: colorForStage(s), display: "inline-block" }} />
                  <span style={{ fontSize: 12, color: "#6b7280" }}>{s}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      <div style={{ position: "relative", width: labelW + totalDays * dayW, height: chartH }}>
        {/* Day header */}
        <div style={{ position: "absolute", left: labelW, top: 0, height: headerH }}>
          {days.map((day) => (
            <div
              key={day.i}
              style={{
                position: "absolute",
                left: day.i * dayW,
                top: 0,
                width: dayW,
                height: headerH,
                borderLeft: "1px solid #f1f5f9",
                background: day.weekend ? "#fafafa" : "transparent",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                paddingBottom: 6,
              }}
            >
              <span style={{ fontSize: 11, color: day.weekend ? "#cbd5e1" : "#94a3b8" }}>
                {["日", "一", "二", "三", "四", "五", "六"][day.d.getDay()]}
              </span>
              <span style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>{fmtMD(day.d)}</span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {rows.map((row, idx) => {
          const offset = dayDiff(minStart, row.start!);
          const barLeft = labelW + offset * dayW + 2;
          const barWidth = row.duration * dayW - 4;
          const top = headerH + idx * rowH;
          const color = colorForStage(row.task.stage);
          return (
            <div key={row.task.id}>
              {/* row background */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top,
                  width: labelW + totalDays * dayW,
                  height: rowH,
                  borderTop: "1px solid #f8fafc",
                  background: idx % 2 === 0 ? "#ffffff" : "#fcfcfd",
                }}
              />
              {/* label */}
              <div
                style={{
                  position: "absolute",
                  left: 8,
                  top: top + 8,
                  width: labelW - 16,
                  fontSize: 13,
                  color: "#374151",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                title={row.task.title}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                {row.task.title}
              </div>
              {/* bar */}
              <div
                style={{
                  position: "absolute",
                  left: barLeft,
                  top: top + 7,
                  width: barWidth,
                  height: rowH - 14,
                  background: row.task.done ? "#d1d5db" : color,
                  borderRadius: 5,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 8,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                }}
              >
                <span style={{ fontSize: 11, color: "#fff", fontWeight: 500, whiteSpace: "nowrap" }}>
                  {row.duration}天{row.task.owner ? ` · ${row.task.owner}` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
