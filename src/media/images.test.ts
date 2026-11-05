import { describe, expect, it } from "vitest";
import { cleanSignaturePixels } from "./images";

describe("signature cleanup", () => {
  it("keeps ink dark and makes white paper transparent", () => {
    const pixels = new Uint8ClampedArray(7 * 7 * 4).fill(255);
    const center = (3 * 7 + 3) * 4;
    pixels[center] = 20;
    pixels[center + 1] = 20;
    pixels[center + 2] = 20;
    const result = cleanSignaturePixels(pixels, 7, 7);
    expect([...result.slice(center, center + 4)]).toEqual([19, 26, 46, 255]);
    expect(result[3]).toBe(0);
    expect(pixels[center + 3]).toBe(255);
  });
  it("removes uneven gray paper shadows while preserving black writing", () => {
    const pixels = new Uint8ClampedArray(9 * 9 * 4);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++) {
        const i = (y * 9 + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 205 + x * 4;
        pixels[i + 3] = 255;
      }
    const ink = (4 * 9 + 4) * 4;
    pixels[ink] = pixels[ink + 1] = pixels[ink + 2] = 35;
    const result = cleanSignaturePixels(pixels, 9, 9);
    expect(result[ink + 3]).toBe(255);
    expect(result[3]).toBe(0);
    expect(result[(8 * 9 + 8) * 4 + 3]).toBe(0);
  });
  it("rejects malformed image buffers", () =>
    expect(() => cleanSignaturePixels(new Uint8ClampedArray(10), 3, 3)).toThrow(
      "Invalid image dimensions",
    ));
});
