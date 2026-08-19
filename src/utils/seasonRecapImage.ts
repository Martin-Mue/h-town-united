export interface SeasonRecapImageParams {
  clubName: string;
  playerName: string;
  emoji: string;
  periodLabel: string;
  games: number;
  wins: number;
  winRate: number;
  bestGameAvg: number;
  total180s: number;
  bestCheckout: number;
  bestStreak: number;
  elo: number;
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

/** Draws a shareable "season wrapped" summary card and returns it as a PNG blob — same pure-
 *  Canvas approach as shareResultImage.ts (no video/gif dependency, works everywhere, no
 *  encoding risk). One condensed poster rather than the full in-app recap sequence: the goal
 *  here is something that survives being pasted into a chat, not a replica of the app screen. */
export async function renderSeasonRecapImage(p: SeasonRecapImageParams): Promise<Blob | null> {
  const W = 1000;
  const H = 1250;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#0b0f17");
  grad.addColorStop(1, "#0e1420");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 22px sans-serif";
  ctx.fillText(p.clubName.toUpperCase(), W / 2, 70);
  ctx.fillStyle = COLORS.primary;
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(p.periodLabel.toUpperCase(), W / 2, 108);

  ctx.font = "80px sans-serif";
  ctx.fillText(p.emoji, W / 2, 210);
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 54px sans-serif";
  ctx.fillText(p.playerName, W / 2, 280);

  type Stat = { label: string; value: string; big?: boolean };
  const stats: Stat[] = [
    { label: "SPIELE", value: String(p.games) },
    { label: "SIEGE", value: `${p.wins} (${p.winRate}%)` },
    { label: "BESTES SPIEL-Ø", value: p.bestGameAvg.toFixed(1) },
    { label: "180ER", value: String(p.total180s) },
    { label: "BESTES FINISH", value: p.bestCheckout > 0 ? String(p.bestCheckout) : "–" },
    { label: "BESTE SERIE", value: `${p.bestStreak} Siege` },
  ];

  const cols = 2;
  const cardW = 420;
  const cardH = 180;
  const gapX = 40;
  const gapY = 30;
  const gridW = cols * cardW + gapX;
  const startX = (W - gridW) / 2;
  const startY = 340;

  stats.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    ctx.fillStyle = COLORS.card;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    const r = 16;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + cardW, y, x + cardW, y + cardH, r);
    ctx.arcTo(x + cardW, y + cardH, x, y + cardH, r);
    ctx.arcTo(x, y + cardH, x, y, r);
    ctx.arcTo(x, y, x + cardW, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.accent;
    ctx.font = "bold 56px sans-serif";
    ctx.fillText(s.value, x + cardW / 2, y + 95);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "600 15px sans-serif";
    ctx.fillText(s.label, x + cardW / 2, y + 135);
  });

  const eloY = startY + 3 * (cardH + gapY) + 20;
  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 15px sans-serif";
  ctx.fillText("ELO-RATING", W / 2, eloY);
  ctx.fillStyle = COLORS.primary;
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(String(p.elo), W / 2, eloY + 50);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "14px sans-serif";
  ctx.fillText(new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }), W / 2, H - 30);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** Shares the image via the Web Share API when available (mobile), otherwise triggers a plain download — same fallback pattern as shareOrDownloadResultImage. */
export async function shareOrDownloadSeasonRecap(params: SeasonRecapImageParams, filename: string) {
  const blob = await renderSeasonRecapImage(params);
  if (!blob) return;

  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Saison-Rückblick" });
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
