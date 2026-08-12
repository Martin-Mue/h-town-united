/**
 * Generates a QR code entirely client-side (no third-party image API — the URL never
 * leaves the device just to render a code for it). Loaded on demand: `qrcode` is only
 * ever needed when someone actually opens the QR dialog, so it shouldn't bloat the
 * main bundle for the vast majority of sessions that never do.
 */
export async function generateQrDataUrl(text: string, size = 320): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    color: { dark: "#0b0f17", light: "#ffffff" },
  });
}
