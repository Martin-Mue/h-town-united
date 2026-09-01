/** Resizes + re-encodes an image client-side before upload. A modern phone photo routinely runs
 *  8-12MB straight off the camera -- far more than any avatar/logo needs at the sizes they're
 *  ever actually displayed -- so rejecting anything over a fixed byte cap (the previous approach)
 *  just makes someone go find a way to shrink the photo themselves first. This does it for them:
 *  downscale to fit within maxDimension on the longest side, re-encode as JPEG at `quality`.
 *  A PNG input stays PNG (skips JPEG re-encoding) so a logo that actually needs transparency
 *  doesn't silently get a black background.
 */
export async function compressImage(file: File, options?: { maxDimension?: number; quality?: number }): Promise<File> {
  const maxDimension = options?.maxDimension ?? 1600;
  const quality = options?.quality ?? 0.85;
  const isPng = file.type === "image/png";

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    el.src = dataUrl;
  });

  // Never upscale -- a smaller source photo is left exactly as-is, only ever shrunk.
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file; // canvas unavailable in this environment -- fall back to the original file untouched

  ctx.drawImage(img, 0, 0, width, height);

  const mimeType = isPng ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, isPng ? undefined : quality));
  if (!blob) return file;

  const ext = isPng ? "png" : "jpg";
  const newName = file.name.replace(/\.\w+$/, "") + "." + ext;
  return new File([blob], newName, { type: mimeType });
}
