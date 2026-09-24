/** Repeatable, fine monochrome static, bounded below 7% white. */
export const STATIC_TILE_SIZE = 96;
export const STATIC_FRAME_MS = 160;
export const STATIC_FADE_MS = 800;
export function staticTile(seed: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(STATIC_TILE_SIZE * STATIC_TILE_SIZE * 4);
  let state = seed + 1;
  for (let i = 0; i < pixels.length; i += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = (state >>> 24) % 18;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }
  return pixels;
}
