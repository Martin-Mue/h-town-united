export interface PlayerCardData {
  clubName: string;
  playerName: string;
  emoji: string;
  eloRating: number;
  average: number;
  highScore: number;
  gamesWon: number;
  gamesPlayed: number;
  oneEightyTotal: number;
  bestCheckout: number;
  /** Emoji glyphs of unlocked achievements only (see Statistics.tsx's playerAchievements) — a
   *  card is meant to brag, so locked ones don't belong on it. */
  unlockedAchievementIcons: string[];
}

const WIDTH = 720;
const HEIGHT = 960;

/** Reads the CURRENTLY active theme's resolved color (whatever club preset + light/dark mode is
 *  live right now — see clubThemePresets.ts) directly off the document, since canvas fill/stroke
 *  styles need a literal color string and can't reference a CSS custom property the way DOM
 *  elements can. */
const themeColor = (varName: string, alpha = 1): string => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return alpha === 1 ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
};

const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const statCell = (
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, w: number,
  value: string, label: string, color: string,
) => {
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.font = "700 40px Oswald, sans-serif";
  ctx.fillText(value, cx, cy);
  ctx.fillStyle = themeColor("--muted-foreground");
  ctx.font = "600 15px Oswald, sans-serif";
  ctx.fillText(label.toUpperCase(), cx, cy + 26);
  void w;
};

/** Draws the card fresh each call onto a new offscreen canvas — cheap enough (one-shot, on
 *  explicit user action) that caching isn't worth the staleness risk if stats change between
 *  shares. Waits on document.fonts.ready first since canvas text doesn't wait for webfonts on its
 *  own — without it, a card generated before the page's own Oswald/Inter fonts finish loading
 *  would silently render in the browser default font instead. */
export async function drawPlayerCard(data: PlayerCardData): Promise<HTMLCanvasElement> {
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;

  const bg = themeColor("--card");
  const border = themeColor("--primary", 0.5);
  const primary = themeColor("--primary");
  const secondary = themeColor("--secondary");
  const accent = themeColor("--accent");
  const foreground = themeColor("--foreground");
  const muted = themeColor("--muted-foreground");

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bgGrad.addColorStop(0, themeColor("--background"));
  bgGrad.addColorStop(1, bg);
  ctx.fillStyle = bgGrad;
  roundRectPath(ctx, 0, 0, WIDTH, HEIGHT, 32);
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = border;
  roundRectPath(ctx, 4, 4, WIDTH - 8, HEIGHT - 8, 30);
  ctx.stroke();

  // Club name
  ctx.textAlign = "center";
  ctx.fillStyle = muted;
  ctx.font = "600 20px Oswald, sans-serif";
  ctx.fillText(data.clubName.toUpperCase(), WIDTH / 2, 70);

  // Avatar ring + emoji
  const avatarCy = 210;
  const avatarR = 100;
  const ringGrad = ctx.createLinearGradient(WIDTH / 2 - avatarR, avatarCy - avatarR, WIDTH / 2 + avatarR, avatarCy + avatarR);
  ringGrad.addColorStop(0, primary);
  ringGrad.addColorStop(1, accent);
  ctx.beginPath();
  ctx.arc(WIDTH / 2, avatarCy, avatarR, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = ringGrad;
  ctx.fillStyle = themeColor("--muted");
  ctx.fill();
  ctx.stroke();
  ctx.font = `${avatarR}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(data.emoji, WIDTH / 2, avatarCy + 8);
  ctx.textBaseline = "alphabetic";

  // Name
  ctx.fillStyle = foreground;
  ctx.font = "700 48px Oswald, sans-serif";
  ctx.fillText(data.playerName, WIDTH / 2, 370);

  // Elo pill
  const eloText = `${Math.round(data.eloRating)} ELO`;
  ctx.font = "700 20px Oswald, sans-serif";
  const eloWidth = ctx.measureText(eloText).width + 48;
  roundRectPath(ctx, WIDTH / 2 - eloWidth / 2, 395, eloWidth, 44, 22);
  ctx.fillStyle = themeColor("--primary", 0.15);
  ctx.fill();
  ctx.fillStyle = primary;
  ctx.fillText(eloText, WIDTH / 2, 424);

  // Divider
  ctx.strokeStyle = themeColor("--border");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 480);
  ctx.lineTo(WIDTH - 60, 480);
  ctx.stroke();

  // Stat grid — 2 cols x 3 rows
  const colX = [WIDTH * 0.28, WIDTH * 0.72];
  const rowY = [560, 650, 740];
  statCell(ctx, colX[0], rowY[0], 200, data.gamesPlayed > 0 ? data.average.toFixed(1) : "–", "Ø Average", secondary);
  statCell(ctx, colX[1], rowY[0], 200, String(data.highScore || 0), "Highscore", accent);
  statCell(ctx, colX[0], rowY[1], 200, String(data.gamesWon), "Siege", primary);
  statCell(ctx, colX[1], rowY[1], 200, String(data.oneEightyTotal), "180er", accent);
  statCell(ctx, colX[0], rowY[2], 200, String(data.gamesPlayed), "Spiele", secondary);
  statCell(ctx, colX[1], rowY[2], 200, data.bestCheckout > 0 ? String(data.bestCheckout) : "–", "Bestes Finish", primary);

  // Achievement icons
  if (data.unlockedAchievementIcons.length > 0) {
    ctx.font = "36px sans-serif";
    const icons = data.unlockedAchievementIcons.slice(0, 8);
    const spacing = 56;
    const startX = WIDTH / 2 - ((icons.length - 1) * spacing) / 2;
    icons.forEach((icon, i) => ctx.fillText(icon, startX + i * spacing, 860));
  }

  // Footer
  ctx.fillStyle = muted;
  ctx.font = "500 14px Inter, sans-serif";
  ctx.fillText(new Date().toLocaleDateString("de-DE"), WIDTH / 2, 920);

  return canvas;
}

/** Renders the card and triggers a browser download as a PNG — same download-via-anchor pattern
 *  Statistics.tsx's CSV export already uses. */
export async function downloadPlayerCard(data: PlayerCardData): Promise<void> {
  const canvas = await drawPlayerCard(data);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = data.playerName.replace(/[^a-z0-9äöüß]+/gi, "-").toLowerCase();
  a.href = url;
  a.download = `spielerkarte-${safeName}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
