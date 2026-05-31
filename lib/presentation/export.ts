/**
 * Presentation export — rasterize HTML slides (rendered by SlideCanvas) into
 * a high-resolution PPTX or PDF. Each slide becomes a full-bleed 16:9 image,
 * preserving the exact Gamma-grade design from the browser.
 */

import { toPng } from "html-to-image";

const SLIDE_W = 1280;
const SLIDE_H = 720;
const SCALE = 2; // 2x for crisp retina-quality export (2560×1440 per slide)

/** Rasterize one mounted slide node to a PNG data URL. */
export async function rasterizeSlide(node: HTMLElement): Promise<string> {
  return toPng(node, {
    width: SLIDE_W,
    height: SLIDE_H,
    pixelRatio: SCALE,
    cacheBust: true,
    // Ensure web fonts are embedded; html-to-image inlines them.
    style: { transform: "none", margin: "0" },
  });
}

/** Build a PPTX where every slide is a full-bleed exported image. */
export async function exportToPptx(
  pngs: string[],
  fileName: string,
): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE16x9", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE16x9";

  for (const png of pngs) {
    const slide = pptx.addSlide();
    slide.addImage({
      data: png,
      x: 0,
      y: 0,
      w: 13.333,
      h: 7.5,
    });
  }

  await pptx.writeFile({ fileName });
}

/** Build a PDF where every slide is a full-page landscape image. */
export async function exportToPdf(
  pngs: string[],
  fileName: string,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  // 16:9 landscape in points: use 1280×720 pt page for exact aspect.
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [SLIDE_W, SLIDE_H],
    compress: true,
  });

  pngs.forEach((png, i) => {
    if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], "landscape");
    pdf.addImage(png, "PNG", 0, 0, SLIDE_W, SLIDE_H, undefined, "FAST");
  });

  pdf.save(fileName);
}
