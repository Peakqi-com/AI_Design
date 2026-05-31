/**
 * SlideCanvas — renders ONE presentation slide as beautiful HTML/CSS at a fixed
 * 1280×720 design size. This is the "Gamma-grade" rendering engine: gradients,
 * full-bleed imagery with scrims, web fonts, hairlines, and adaptive layouts.
 *
 * The fixed pixel size means a slide can be rasterized (html-to-image) at exact
 * 16:9 for PPTX/PDF export, and scaled down with CSS transform for previews.
 */

import React from "react";
import { SlideTheme, RichLayout } from "@/lib/presentation/themes";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

export interface CanvasSlide {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  layout: RichLayout;
  /** Optional extra images for grid/comparison layouts. */
  extraImages?: string[];
}

interface SlideCanvasProps {
  slide: CanvasSlide;
  theme: SlideTheme;
  index: number;
  total: number;
  projectTitle?: string;
  designerName?: string;
  /** When true, render at full 1280×720 (for rasterization). Otherwise caller scales. */
  exportMode?: boolean;
}

/* ---- helpers ---- */

// Split body text into bullet lines (handles \n, 、, ・, leading bullets).
const toLines = (body: string): string[] =>
  body
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•·–\-*]+/, "").trim())
    .filter(Boolean);

// Parse "項目：金額" or "項目\t金額" or "名稱 NT$ 12,000" style rows for tables.
interface Row { label: string; value: string }
const parseRows = (body: string): Row[] => {
  const lines = toLines(body);
  const rows: Row[] = [];
  for (const line of lines) {
    // try splitting on last colon / tab / "：" / multiple spaces before a number
    const m =
      line.match(/^(.*?)[：:\t]\s*(NT\$?\s?[\d,]+.*)$/) ||
      line.match(/^(.*?)\s+(NT\$?\s?[\d,]+.*)$/) ||
      line.match(/^(.*?)[：:\t]\s*(.+)$/);
    if (m) rows.push({ label: m[1].trim(), value: m[2].trim() });
    else rows.push({ label: line, value: "" });
  }
  return rows;
};

const fontImport = (theme: SlideTheme) => theme; // fonts loaded globally via <link>

export const SlideCanvas: React.FC<SlideCanvasProps> = ({
  slide,
  theme,
  index,
  total,
  projectTitle,
  designerName,
}) => {
  const c = theme.colors;
  fontImport(theme);

  const base: React.CSSProperties = {
    width: SLIDE_W,
    height: SLIDE_H,
    position: "relative",
    overflow: "hidden",
    fontFamily: theme.fontBody,
    color: c.ink,
    boxSizing: "border-box",
  };

  const pageNum = (light?: boolean) => (
    <div
      style={{
        position: "absolute",
        bottom: 28,
        right: 40,
        fontSize: 18,
        letterSpacing: 2,
        color: light ? "rgba(255,255,255,0.75)" : c.muted,
        fontFamily: theme.fontBody,
        fontWeight: 300,
      }}
    >
      {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
    </div>
  );

  const kicker = (text: string, light?: boolean) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 22,
      }}
    >
      <span style={{ width: 46, height: 2, background: c.accent, display: "block" }} />
      <span
        style={{
          fontSize: 18,
          letterSpacing: 6,
          textTransform: "uppercase",
          color: light ? "rgba(255,255,255,0.85)" : c.accent,
          fontWeight: 500,
        }}
      >
        {text}
      </span>
    </div>
  );

  const imgEl = (url: string, style?: React.CSSProperties) => (
    <img
      src={url}
      alt=""
      crossOrigin="anonymous"
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...style }}
    />
  );

  const placeholder = (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${c.accentSoft}, ${c.surface})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: c.muted,
        fontSize: 22,
      }}
    >
      室內設計圖
    </div>
  );

  /* ============================ COVER ============================ */
  if (slide.layout === "cover") {
    return (
      <div style={{ ...base, background: c.bg }}>
        {slide.imageUrl && (
          <>
            <div style={{ position: "absolute", inset: 0 }}>{imgEl(slide.imageUrl)}</div>
            <div style={{ position: "absolute", inset: 0, background: c.overlay }} />
          </>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: "0 90px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {kicker("Interior Design Proposal", Boolean(slide.imageUrl))}
          <div
            style={{
              fontFamily: theme.fontDisplay,
              fontSize: 78,
              fontWeight: 700,
              lineHeight: 1.1,
              color: slide.imageUrl ? "#fff" : c.ink,
              maxWidth: 980,
              letterSpacing: -1,
            }}
          >
            {projectTitle || slide.title}
          </div>
          {(slide.body || designerName) && (
            <div
              style={{
                marginTop: 34,
                fontSize: 26,
                fontWeight: 300,
                color: slide.imageUrl ? "rgba(255,255,255,0.9)" : c.muted,
                whiteSpace: "pre-wrap",
                maxWidth: 820,
                lineHeight: 1.6,
              }}
            >
              {slide.body || `設計師　${designerName}`}
            </div>
          )}
        </div>
        {pageNum(Boolean(slide.imageUrl))}
      </div>
    );
  }

  /* ============================ CLOSING ============================ */
  if (slide.layout === "closing") {
    return (
      <div style={{ ...base, background: c.bg }}>
        {slide.imageUrl && (
          <>
            <div style={{ position: "absolute", inset: 0 }}>{imgEl(slide.imageUrl)}</div>
            <div style={{ position: "absolute", inset: 0, background: c.overlay }} />
          </>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "0 120px",
          }}
        >
          <div
            style={{
              fontFamily: theme.fontDisplay,
              fontSize: 64,
              fontWeight: 700,
              color: slide.imageUrl ? "#fff" : c.ink,
              lineHeight: 1.15,
            }}
          >
            {slide.title || "期待與您共創理想居家"}
          </div>
          <span style={{ width: 80, height: 2, background: c.accent, display: "block", margin: "32px 0" }} />
          <div
            style={{
              fontSize: 24,
              fontWeight: 300,
              color: slide.imageUrl ? "rgba(255,255,255,0.9)" : c.muted,
              whiteSpace: "pre-wrap",
              lineHeight: 1.7,
              maxWidth: 760,
            }}
          >
            {slide.body}
          </div>
          {designerName && (
            <div style={{ marginTop: 30, fontSize: 20, color: c.accent, letterSpacing: 2 }}>
              {designerName}
            </div>
          )}
        </div>
        {pageNum(Boolean(slide.imageUrl))}
      </div>
    );
  }

  /* ============================ IMAGE-FULL ============================ */
  if (slide.layout === "image-full") {
    return (
      <div style={{ ...base, background: c.bg }}>
        <div style={{ position: "absolute", inset: 0 }}>
          {slide.imageUrl ? imgEl(slide.imageUrl) : placeholder}
        </div>
        <div style={{ position: "absolute", inset: 0, background: c.overlay }} />
        <div style={{ position: "absolute", left: 90, right: 90, bottom: 80 }}>
          {kicker(`0${index + 1}`, true)}
          <div
            style={{
              fontFamily: theme.fontDisplay,
              fontSize: 52,
              fontWeight: 700,
              color: "#fff",
              lineHeight: 1.15,
              maxWidth: 900,
            }}
          >
            {slide.title}
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: 23,
              fontWeight: 300,
              color: "rgba(255,255,255,0.92)",
              lineHeight: 1.6,
              maxWidth: 860,
              whiteSpace: "pre-wrap",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {slide.body}
          </div>
        </div>
        {pageNum(true)}
      </div>
    );
  }

  /* ============================ IMAGE-LEFT / IMAGE-RIGHT ============================ */
  if (slide.layout === "image-left" || slide.layout === "image-right") {
    const imageFirst = slide.layout === "image-left";
    const lines = toLines(slide.body);
    const imageBlock = (
      <div style={{ width: 560, height: "100%", flexShrink: 0, position: "relative" }}>
        {slide.imageUrl ? imgEl(slide.imageUrl) : placeholder}
      </div>
    );
    const textBlock = (
      <div
        style={{
          flex: 1,
          padding: "90px 80px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {kicker(`0${index + 1}`)}
        <div
          style={{
            fontFamily: theme.fontDisplay,
            fontSize: 46,
            fontWeight: 700,
            lineHeight: 1.2,
            color: c.ink,
            marginBottom: 26,
          }}
        >
          {slide.title}
        </div>
        {lines.length > 1 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {lines.slice(0, 6).map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    background: c.accent,
                    marginTop: 12,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 22, lineHeight: 1.55, color: c.muted }}>{l}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 23, lineHeight: 1.7, color: c.muted, whiteSpace: "pre-wrap" }}>
            {slide.body}
          </div>
        )}
      </div>
    );
    return (
      <div style={{ ...base, background: c.surface, display: "flex" }}>
        {imageFirst ? imageBlock : textBlock}
        {imageFirst ? textBlock : imageBlock}
        {pageNum()}
      </div>
    );
  }

  /* ============================ QUOTE ============================ */
  if (slide.layout === "quote") {
    return (
      <div
        style={{
          ...base,
          background: theme.mood === "dark" ? c.bg : c.surface,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 140px",
        }}
      >
        <div style={{ fontFamily: theme.fontDisplay, fontSize: 120, color: c.accent, lineHeight: 0.6, marginBottom: 10 }}>
          “
        </div>
        <div
          style={{
            fontFamily: theme.fontDisplay,
            fontSize: 46,
            fontWeight: 600,
            lineHeight: 1.45,
            color: c.ink,
            maxWidth: 980,
          }}
        >
          {slide.title}
        </div>
        {slide.body && (
          <div style={{ marginTop: 30, fontSize: 23, fontWeight: 300, color: c.muted, lineHeight: 1.7, maxWidth: 880, whiteSpace: "pre-wrap" }}>
            {slide.body}
          </div>
        )}
        {pageNum()}
      </div>
    );
  }

  /* ============================ TABLE (quotation/budget) ============================ */
  if (slide.layout === "table") {
    const rows = parseRows(slide.body);
    // detect a total row (last row whose label contains 總/total)
    return (
      <div style={{ ...base, background: c.surface, padding: "70px 90px" }}>
        {kicker(`0${index + 1}`)}
        <div style={{ fontFamily: theme.fontDisplay, fontSize: 44, fontWeight: 700, color: c.ink, marginBottom: 28 }}>
          {slide.title}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.slice(0, 11).map((r, i) => {
            const isTotal = /總|合計|total|小計/i.test(r.label);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 0",
                  borderBottom: `1px solid ${c.line}`,
                  ...(isTotal
                    ? { borderTop: `2px solid ${c.accent}`, borderBottom: "none", marginTop: 6 }
                    : {}),
                }}
              >
                <span
                  style={{
                    fontSize: isTotal ? 24 : 21,
                    fontWeight: isTotal ? 700 : 400,
                    color: isTotal ? c.ink : c.muted,
                  }}
                >
                  {r.label}
                </span>
                <span
                  style={{
                    fontSize: isTotal ? 26 : 21,
                    fontWeight: isTotal ? 700 : 500,
                    color: isTotal ? c.accent : c.ink,
                    fontFamily: theme.fontBody,
                  }}
                >
                  {r.value}
                </span>
              </div>
            );
          })}
        </div>
        {pageNum()}
      </div>
    );
  }

  /* ============================ TIMELINE ============================ */
  if (slide.layout === "timeline") {
    const lines = toLines(slide.body);
    return (
      <div style={{ ...base, background: c.surface, padding: "70px 90px" }}>
        {kicker(`0${index + 1}`)}
        <div style={{ fontFamily: theme.fontDisplay, fontSize: 44, fontWeight: 700, color: c.ink, marginBottom: 40 }}>
          {slide.title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {lines.slice(0, 6).map((l, i, arr) => {
            const m = l.match(/^(.*?)[：:\s]\s*(.+)$/);
            const phase = m ? m[1].trim() : l;
            const detail = m ? m[2].trim() : "";
            return (
              <div key={i} style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40 }}>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 99,
                      background: c.accent,
                      flexShrink: 0,
                      marginTop: 6,
                    }}
                  />
                  {i < arr.length - 1 && (
                    <span style={{ width: 2, flex: 1, background: c.line, minHeight: 40 }} />
                  )}
                </div>
                <div style={{ paddingBottom: 26 }}>
                  <div style={{ fontSize: 24, fontWeight: 600, color: c.ink }}>{phase}</div>
                  {detail && <div style={{ fontSize: 20, color: c.muted, marginTop: 4 }}>{detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
        {pageNum()}
      </div>
    );
  }

  /* ============================ TWO-IMAGES (before/after) ============================ */
  if (slide.layout === "two-images") {
    const imgs = [slide.imageUrl, slide.extraImages?.[0]].filter(Boolean) as string[];
    return (
      <div style={{ ...base, background: c.surface, padding: "60px 70px" }}>
        <div style={{ fontFamily: theme.fontDisplay, fontSize: 42, fontWeight: 700, color: c.ink, marginBottom: 24 }}>
          {slide.title}
        </div>
        <div style={{ display: "flex", gap: 24, height: 460 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ flex: 1, borderRadius: 14, overflow: "hidden", background: c.accentSoft }}>
              {imgs[i] ? imgEl(imgs[i]) : placeholder}
            </div>
          ))}
        </div>
        {slide.body && (
          <div style={{ marginTop: 22, fontSize: 21, color: c.muted, lineHeight: 1.6 }}>{slide.body}</div>
        )}
        {pageNum()}
      </div>
    );
  }

  /* ============================ BULLETS (text-only, no image) ============================ */
  const lines = toLines(slide.body);
  return (
    <div style={{ ...base, background: c.surface, padding: "80px 90px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      {kicker(`0${index + 1}`)}
      <div style={{ fontFamily: theme.fontDisplay, fontSize: 48, fontWeight: 700, color: c.ink, marginBottom: 36, lineHeight: 1.2 }}>
        {slide.title}
      </div>
      {lines.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {lines.slice(0, 6).map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: c.accent, minWidth: 34 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: 24, lineHeight: 1.55, color: c.muted }}>{l}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 26, lineHeight: 1.8, color: c.muted, whiteSpace: "pre-wrap", maxWidth: 980 }}>
          {slide.body}
        </div>
      )}
      {pageNum()}
    </div>
  );
};
