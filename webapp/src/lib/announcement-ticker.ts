export const ANNOUNCEMENT_PIXELS_PER_SECOND = 64;

export function announcementTickerLayout(viewportWidth: number, itemWidth: number) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(itemWidth) || viewportWidth <= 0 || itemWidth <= 0) return null;
  return {
    copies: Math.ceil(viewportWidth / itemWidth) + 1,
    distance: itemWidth,
    duration: itemWidth / ANNOUNCEMENT_PIXELS_PER_SECOND,
  };
}
