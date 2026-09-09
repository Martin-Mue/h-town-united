export interface ShareResultPlayer {
  name: string;
  average: number;
  highscore: number;
  s180: number;
  legs: number;
}

export interface ShareResultParams {
  clubName: string;
  mode: string;
  winnerName: string;
  bestOfLegs: number;
  players: ShareResultPlayer[];
  /** KI-Spielbericht (2026-09-09): the AI-generated recap text, when one was already generated
   *  for this match (see AiMatchReport.tsx / Game.tsx's shareResult()). Optional — omitted
   *  entirely from the card (not even an empty section) when nobody generated one. */
  aiReport?: string;
}

const COLORS = {
  bg: "#0b0f17",
  card: "#131a26",
  border: "#1e2733",
  primary: "#22d3ee",
  accent: "#facc15",
  text: "#e5e9f0",
  muted: "#8b96a8",
};

/** Greedy word-wrap for a Canvas 2D context — European-language text is simply space-separated,
 *  so no need for anything fancier than "does the next word still fit". Assumes `ctx.font` is
 *  already set to whatever font the wrapped lines will actually be drawn in, since the wrap
 *  decision depends on that font's measured widths. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const AI_REPORT_FONT = "italic 20px sans-serif";
const AI_REPORT_LINE_HEIGHT = 30;

/** Draws a shareable match-result card and returns it as a PNG blob. Pure Canvas — no extra dependency. */
export async function renderResultImage(params: ShareResultParams): Promise<Blob | null> {
  const W = 900;
  const rowH = 90;
  const reportMaxWidth = W - 160;
  // Wrapped on a throwaway measuring context BEFORE the real canvas is sized — canvas.width/height
  // must be set up front (setting either clears the canvas), so the final height needs to already
  // account for however many lines the AI report wraps to.
  let reportLines: string[] = [];
  if (params.aiReport) {
    const measureCtx = document.createElement("canvas").getContext("2d");
    if (measureCtx) {
      measureCtx.font = AI_REPORT_FONT;
      reportLines = wrapText(measureCtx, params.aiReport, reportMaxWidth);
    }
  }
  const reportBlockHeight = reportLines.length > 0 ? 50 + reportLines.length * AI_REPORT_LINE_HEIGHT : 0;
  const H = 420 + params.players.length * rowH + reportBlockHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = COLORS.primary;
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(params.clubName.toUpperCase(), W / 2, 60);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "16px sans-serif";
  ctx.fillText(params.mode.toUpperCase() + (params.bestOfLegs > 1 ? ` · FIRST TO ${Math.ceil(params.bestOfLegs / 2)}` : ""), W / 2, 90);

  ctx.fillStyle = COLORS.accent;
  ctx.font = "bold 52px sans-serif";
  ctx.fillText(params.winnerName, W / 2, 170);
  ctx.fillStyle = COLORS.text;
  ctx.font = "20px sans-serif";
  ctx.fillText("GEWINNT!", W / 2, 205);

  const tableTop = 260;
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, tableTop);
  ctx.lineTo(W - 60, tableTop);
  ctx.stroke();

  ctx.textAlign = "left";
  params.players.forEach((p, i) => {
    const y = tableTop + 55 + i * rowH;
    ctx.fillStyle = COLORS.card;
    ctx.fillRect(60, y - 40, W - 120, rowH - 16);
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(p.name, 90, y);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = COLORS.muted;
    const statsText = `Ø ${p.average.toFixed(1)}   ·   High ${p.highscore}${p.s180 > 0 ? `   ·   🎯 ${p.s180}× 180` : ""}`;
    ctx.fillText(statsText, 90, y + 26);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.primary;
    ctx.font = "bold 30px sans-serif";
    ctx.fillText(`${p.legs}`, W - 90, y);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("LEGS", W - 90, y + 20);
    ctx.textAlign = "left";
  });

  // KI-Spielbericht (2026-09-09): drawn as its own card below the player rows, only when one was
  // actually generated for this match (reportLines stays empty otherwise, and reportBlockHeight
  // above already left no extra space to draw into in that case).
  if (reportLines.length > 0) {
    const blockTop = tableTop + 55 + params.players.length * rowH - 20;
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.accent;
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("📰 KI-SPIELBERICHT", 90, blockTop + 20);
    ctx.fillStyle = COLORS.text;
    ctx.font = AI_REPORT_FONT;
    reportLines.forEach((line, i) => {
      ctx.fillText(line, 90, blockTop + 20 + 32 + i * AI_REPORT_LINE_HEIGHT);
    });
  }

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.muted;
  ctx.font = "14px sans-serif";
  ctx.fillText(new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }), W / 2, H - 25);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** Shares the image via the Web Share API when available (mobile), otherwise triggers a plain download. */
export async function shareOrDownloadResultImage(params: ShareResultParams, filename: string) {
  const blob = await renderResultImage(params);
  if (!blob) return;

  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Spielergebnis" });
      return;
    } catch {
      // user cancelled or share failed — fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
