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

/** Draws a shareable match-result card and returns it as a PNG blob. Pure Canvas — no extra dependency. */
export async function renderResultImage(params: ShareResultParams): Promise<Blob | null> {
  const W = 900;
  const rowH = 90;
  const H = 420 + params.players.length * rowH;
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
