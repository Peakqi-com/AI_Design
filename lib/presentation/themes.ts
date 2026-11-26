/**
 * Presentation themes — beautiful, interior-design-grade visual systems.
 *
 * Each theme is a complete design language: typography pairing, color palette,
 * and accent treatment. Rendered as HTML/CSS (not PPTX) so we get gradients,
 * shadows, full-bleed imagery, and real web fonts — Gamma/Canva-grade output.
 */

export interface SlideTheme {
  id: string;
  label: string;
  description: string;
  mood: "dark" | "light";
  /** Google Fonts family for headings (display). */
  fontDisplay: string;
  /** Google Fonts family for body text. */
  fontBody: string;
  /** Google Fonts URL bits to load (family + weights). */
  googleFonts: string[];
  colors: {
    bg: string;        // page / cover background
    surface: string;   // content slide background
    ink: string;       // primary text
    muted: string;     // secondary text
    accent: string;    // primary accent (lines, numbers, highlights)
    accentSoft: string;// soft accent backdrop
    line: string;      // hairline divider color
    overlay: string;   // image scrim gradient (CSS gradient value)
  };
}

export const SLIDE_THEMES: SlideTheme[] = [
  {
    id: "atelier",
    label: "鬱金 Atelier",
    description: "深炭背景 × 黃銅金線，襯線標題，象徵高端豪宅提案",
    mood: "dark",
    fontDisplay: "'Noto Serif TC', serif",
    fontBody: "'Noto Sans TC', sans-serif",
    googleFonts: [
      "Noto+Serif+TC:wght@500;600;700;900",
      "Noto+Sans+TC:wght@300;400;500;700",
    ],
    colors: {
      bg: "#17120d",
      surface: "#1e1813",
      ink: "#f4ecdf",
      muted: "#b8a98f",
      accent: "#c8a86a",
      accentSoft: "rgba(200,168,106,0.14)",
      line: "rgba(200,168,106,0.32)",
      overlay: "linear-gradient(to top, rgba(10,7,4,0.92) 0%, rgba(10,7,4,0.35) 45%, rgba(10,7,4,0) 75%)",
    },
  },
  {
    id: "nordic",
    label: "北歐晨光 Nordic",
    description: "暖白留白 × 鼠尾草綠，無襯線極簡，像 Gamma / Keynote",
    mood: "light",
    fontDisplay: "'Noto Sans TC', sans-serif",
    fontBody: "'Noto Sans TC', sans-serif",
    googleFonts: ["Noto+Sans+TC:wght@300;400;500;700;900"],
    colors: {
      bg: "#f6f3ec",
      surface: "#fbf9f4",
      ink: "#2c2a26",
      muted: "#8c857a",
      accent: "#7f9070",
      accentSoft: "rgba(127,144,112,0.12)",
      line: "rgba(44,42,38,0.12)",
      overlay: "linear-gradient(to top, rgba(28,26,22,0.78) 0%, rgba(28,26,22,0.18) 50%, rgba(28,26,22,0) 78%)",
    },
  },
  {
    id: "editorial",
    label: "編輯誌 Editorial",
    description: "米色紙感 × 赤陶橘，大襯線標題，雜誌作品集風格",
    mood: "light",
    fontDisplay: "'Playfair Display', 'Noto Serif TC', serif",
    fontBody: "'Noto Sans TC', sans-serif",
    googleFonts: [
      "Playfair+Display:ital,wght@0,500;0,700;0,900;1,500",
      "Noto+Serif+TC:wght@500;700",
      "Noto+Sans+TC:wght@300;400;500;700",
    ],
    colors: {
      bg: "#f3efe6",
      surface: "#f7f4ec",
      ink: "#26211c",
      muted: "#8a7d6d",
      accent: "#b15a38",
      accentSoft: "rgba(177,90,56,0.10)",
      line: "rgba(38,33,28,0.14)",
      overlay: "linear-gradient(to top, rgba(20,16,12,0.82) 0%, rgba(20,16,12,0.2) 52%, rgba(20,16,12,0) 80%)",
    },
  },
  {
    id: "studio",
    label: "摩登工作室 Studio",
    description: "純白網格 × 鈷藍重點，緊湊無襯線，現代設計事務所",
    mood: "light",
    fontDisplay: "'Noto Sans TC', sans-serif",
    fontBody: "'Noto Sans TC', sans-serif",
    googleFonts: ["Noto+Sans+TC:wght@300;400;500;700;900"],
    colors: {
      bg: "#ffffff",
      surface: "#ffffff",
      ink: "#14171f",
      muted: "#6b7280",
      accent: "#2b4eff",
      accentSoft: "rgba(43,78,255,0.08)",
      line: "rgba(20,23,31,0.10)",
      overlay: "linear-gradient(to top, rgba(8,10,16,0.85) 0%, rgba(8,10,16,0.2) 50%, rgba(8,10,16,0) 78%)",
    },
  },
];

export const getTheme = (id: string): SlideTheme =>
  SLIDE_THEMES.find((t) => t.id === id) || SLIDE_THEMES[0];

/** Build the Google Fonts <link> href for a theme. */
export const buildGoogleFontsHref = (theme: SlideTheme): string => {
  const families = theme.googleFonts.map((f) => `family=${f}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
};

/** Slide layout kinds the renderer understands. */
export type RichLayout =
  | "cover"
  | "section"
  | "image-full"
  | "image-left"
  | "image-right"
  | "two-images"
  | "image-grid"
  | "quote"
  | "bullets"
  | "table"
  | "timeline"
  | "closing";

/**
 * Map a legacy SlideData.layout (+ position) to a rich layout.
 * Keeps backward compatibility with existing decks while upgrading visuals.
 */
export const resolveRichLayout = (
  legacy: string,
  index: number,
  total: number,
  hasImage: boolean,
  title: string,
  body: string,
): RichLayout => {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  if (isFirst) return "cover";
  if (isLast) return "closing";

  // Content-aware detection from the AI-written title/body.
  const t = `${title}`;
  if (/預算|報價|投資|費用|金額|estimate|budget|quotation/i.test(t)) return "table";
  if (/時程|流程|進度|排程|timeline|schedule|階段/i.test(t)) return "timeline";
  if (/理念|概念|願景|主張|哲學|concept|vision/i.test(t) && body.length < 120) return "quote";

  if (legacy === "full-image" && hasImage) return "image-full";
  if (legacy === "left-image" && hasImage) return "image-left";
  if (legacy === "right-image" && hasImage) return "image-right";
  if (!hasImage) return "bullets";
  // default alternation for image content
  return index % 2 === 0 ? "image-left" : "image-right";
};
