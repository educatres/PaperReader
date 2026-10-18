import type { Point, Quad, Screenshot } from '../types';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function selectionRect(a: Point, b: Point): Quad {
  const x = Math.min(clamp(a.x), clamp(b.x)); const y = Math.min(clamp(a.y), clamp(b.y));
  return { x, y, width: Math.max(clamp(a.x), clamp(b.x)) - x, height: Math.max(clamp(a.y), clamp(b.y)) - y };
}

// Canonical source coordinates use PDF.js rotation=0, independent of intrinsic
// page rotation, viewing rotation, zoom, and the canvas device pixel ratio.
export function rotateRegion(q: Quad, degrees: number): Quad {
  const turn = ((degrees % 360) + 360) % 360;
  let result = { ...q };
  if (turn === 90) result = { x: 1 - q.y - q.height, y: q.x, width: q.height, height: q.width };
  if (turn === 180) result = { x: 1 - q.x - q.width, y: 1 - q.y - q.height, width: q.width, height: q.height };
  if (turn === 270) result = { x: q.y, y: 1 - q.x - q.width, width: q.height, height: q.width };
  // Avoid tiny negative coordinates from floating-point roundoff at page edges.
  return { x: clamp(result.x), y: clamp(result.y), width: clamp(result.width), height: clamp(result.height) };
}

export const maxImageBytes = 20 * 1024 * 1024;
export function cropPage(canvas: HTMLCanvasElement, region: Quad) {
  const x = Math.max(0, Math.floor(region.x * canvas.width)); const y = Math.max(0, Math.floor(region.y * canvas.height));
  const width = Math.min(canvas.width, Math.ceil((region.x + region.width) * canvas.width)) - x;
  const height = Math.min(canvas.height, Math.ceil((region.y + region.height) * canvas.height)) - y;
  if (width < 1 || height < 1) throw new Error('請框選較大的 PDF 區域。');
  if (width > 12000 || height > 12000) throw new Error('截圖尺寸過大，請縮小框選區域。');
  const crop = document.createElement('canvas'); crop.width = width; crop.height = height;
  const context = crop.getContext('2d'); if (!context) throw new Error('無法建立截圖，請稍後重試。');
  // Copy only the PDF render canvas, excluding text/highlight/selection overlays.
  context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return { width, height, blob: new Promise<Blob>((resolve, reject) => crop.toBlob(blob => {
    if (!blob) reject(new Error('截圖失敗，請重新框選。'));
    else if (blob.size > maxImageBytes) reject(new Error('單張截圖上限為 20 MB，請縮小框選區域。'));
    else resolve(blob);
  }, 'image/png')) };
}

export function validateImageHeader(buffer: ArrayBuffer, image: Screenshot) {
  const bytes = new Uint8Array(buffer); const header = new DataView(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (buffer.byteLength !== image.size || bytes.length < 33 || !signature.every((v, i) => bytes[i] === v)
    || header.getUint32(16) !== image.width || header.getUint32(20) !== image.height) throw new Error('截圖的 PNG 格式、尺寸或檔案大小不符。');
}
