// Client-side image preprocessing. Keeps API payloads small and well under
// Fluid Compute's request size, and strips EXIF metadata as a side effect
// (the canvas round-trip discards it).
//
// Why 1280px longest edge? Haiku encodes images internally at ~1092px max
// anyway — sending larger is wasted bandwidth. 1280px gives a small margin.

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.85;

export async function fileToResizedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`Not an image: ${file.name}`);
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context.');

  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // JPEG for photos — PNG would double the payload for typical product shots.
  // Alpha channels are rare in product images; if the source has one, it'll be
  // flattened onto white, which is the Noon-preferred background anyway.
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

export function estimateDataUrlBytes(dataUrl: string): number {
  // base64 inflates by ~4/3 of raw bytes.
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return 0;
  const b64 = dataUrl.slice(commaIdx + 1);
  return Math.floor((b64.length * 3) / 4);
}
