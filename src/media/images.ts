export interface Point {
  x: number;
  y: number;
}
export type Quadrilateral = [Point, Point, Point, Point];

export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 0.8,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The image could not be saved.")),
      type,
      quality,
    ),
  );
}

export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resize evidence, proof and borrower photographs before they reach IndexedDB. */
export async function compressImage(blob: Blob, maxSide = 1600): Promise<Blob> {
  if (!blob.type.startsWith("image/"))
    throw new Error("Please choose an image file.");
  const image = await loadImage(blob);
  const scale = Math.min(
    1,
    maxSide / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image editing is unavailable in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas, "image/jpeg", 0.8);
}

export function rotateCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.height;
  canvas.height = source.width;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Adaptive local threshold removes paper shadows without erasing dark handwriting. */
export function cleanSignaturePixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 15,
  offset = 12,
): Uint8ClampedArray {
  if (rgba.length !== width * height * 4)
    throw new Error("Invalid image dimensions.");
  const gray = new Uint8ClampedArray(width * height);
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;
      gray[p] = Math.round(
        rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114,
      );
      rowSum += gray[p];
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowSum;
    }
  }
  const output = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      const mean =
        (integral[bottom * stride + right] -
          integral[top * stride + right] -
          integral[bottom * stride + left] +
          integral[top * stride + left]) /
        ((right - left) * (bottom - top));
      const p = y * width + x;
      const i = p * 4;
      const isInk = gray[p] < Math.min(190, mean - offset);
      output[i] = 19;
      output[i + 1] = 26;
      output[i + 2] = 46;
      output[i + 3] = isInk
        ? Math.min(255, Math.round((mean - gray[p]) * 2.5))
        : 0;
    }
  return output;
}

/** A projective transform rectifies four selected paper corners into a rectangle. */
export function perspectiveCrop(
  source: HTMLCanvasElement,
  corners: Quadrilateral,
): HTMLCanvasElement {
  const cross = corners.map((point, i) => {
    const next = corners[(i + 1) % 4];
    const after = corners[(i + 2) % 4];
    return (
      (next.x - point.x) * (after.y - next.y) -
      (next.y - point.y) * (after.x - next.x)
    );
  });
  if (cross.some((value) => value <= 0))
    throw new Error(
      "Select four corners clockwise without crossing the edges. Keep some space around the signature.",
    );
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.max(
    1,
    Math.round(
      Math.max(
        distance(corners[0], corners[1]),
        distance(corners[3], corners[2]),
      ),
    ),
  );
  const height = Math.max(
    1,
    Math.round(
      Math.max(
        distance(corners[0], corners[3]),
        distance(corners[1], corners[2]),
      ),
    ),
  );
  if (width * height > 1600 * 1600)
    throw new Error("Crop is too large. Select the signature box only.");
  const [a, b, c, d] = corners;
  const dx1 = b.x - c.x;
  const dx2 = d.x - c.x;
  const dx3 = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y;
  const dy2 = d.y - c.y;
  const dy3 = a.y - b.y + c.y - d.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g =
    Math.abs(determinant) > 0.0001 ? (dx3 * dy2 - dx2 * dy3) / determinant : 0;
  const h =
    Math.abs(determinant) > 0.0001 ? (dx1 * dy3 - dx3 * dy1) / determinant : 0;
  const ax = b.x - a.x + g * b.x;
  const bx = d.x - a.x + h * d.x;
  const ay = b.y - a.y + g * b.y;
  const by = d.y - a.y + h * d.y;
  const data = source
    .getContext("2d")!
    .getImageData(0, 0, source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const output = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1);
      const v = y / Math.max(1, height - 1);
      const w = g * u + h * v + 1;
      const sx = Math.max(
        0,
        Math.min(source.width - 1, Math.round((ax * u + bx * v + a.x) / w)),
      );
      const sy = Math.max(
        0,
        Math.min(source.height - 1, Math.round((ay * u + by * v + a.y) / w)),
      );
      const from = (sy * source.width + sx) * 4;
      const to = (y * width + x) * 4;
      output.data.set(data.data.subarray(from, from + 4), to);
    }
  ctx.putImageData(output, 0, 0);
  return canvas;
}

export async function cleanSignature(
  source: HTMLCanvasElement,
  corners?: Quadrilateral,
): Promise<Blob> {
  const canvas = corners ? perspectiveCrop(source, corners) : source;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  data.data.set(cleanSignaturePixels(data.data, canvas.width, canvas.height));
  ctx.putImageData(data, 0, 0);
  return canvasBlob(canvas);
}
