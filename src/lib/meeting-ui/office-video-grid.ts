/**
 * Galeria flutuante de vídeos sobre o Office (RemoteVideoTiles) — só layout,
 * sem RTC. Escolhe colunas que maximizam o tile 16:9 dentro da área disponível.
 */
export const OFFICE_TILE_MIN_W = 160;
export const OFFICE_TILE_MAX_W = 240;
export const OFFICE_TILE_SINGLE_MAX_W = 320;
export const OFFICE_GRID_MAX_COLS = 4;
export const OFFICE_GRID_GAP = 8;

export type OfficeVideoGrid = {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  /** true quando nem o tile mínimo cabe na altura → scroll interno. */
  scroll: boolean;
};

function preferredCols(n: number): number {
  if (n <= 3) return 1;
  if (n <= 6) return 2;
  if (n <= 12) return 3;
  return 4;
}

export function planOfficeVideoGrid(
  count: number,
  availableWidth: number,
  availableHeight: number,
  gap = OFFICE_GRID_GAP,
): OfficeVideoGrid {
  const n = Math.max(1, Math.floor(count));
  const W = Math.max(OFFICE_TILE_MIN_W, availableWidth);
  const H = Math.max(90, availableHeight);
  const cap = n === 1 ? OFFICE_TILE_SINGLE_MAX_W : OFFICE_TILE_MAX_W;
  const target = preferredCols(n);
  const maxCols = Math.min(OFFICE_GRID_MAX_COLS, n);

  let best: { cols: number; w: number; fits: boolean } | null = null;
  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(n / cols);
    const byW = (W - gap * (cols - 1)) / cols;
    const byH = ((H - gap * (rows - 1)) / rows) * (16 / 9);
    const w = Math.floor(Math.min(cap, byW, byH));
    const fits = w >= OFFICE_TILE_MIN_W;
    // Se não couber no mínimo pela altura, avalia pela largura (haverá scroll).
    const score = fits ? w : Math.min(cap, Math.floor(byW));
    if (byW < OFFICE_TILE_MIN_W && cols > 1) continue;
    const cand = { cols, w: fits ? w : Math.max(OFFICE_TILE_MIN_W, Math.min(score, cap)), fits };
    if (!best) { best = cand; continue; }
    if (cand.fits !== best.fits) { if (cand.fits) best = cand; continue; }
    if (!cand.fits) {
      // Sem caber: mais colunas = menos scroll.
      if (cand.cols > best.cols) best = cand;
      continue;
    }
    if (cand.w > best.w + 4) best = cand;
    else if (Math.abs(cand.w - best.w) <= 4 &&
      Math.abs(cand.cols - target) < Math.abs(best.cols - target)) best = cand;
  }
  const b = best ?? { cols: 1, w: OFFICE_TILE_MIN_W, fits: false };
  const rows = Math.ceil(n / b.cols);
  const tileWidth = Math.min(b.w, Math.floor((W - gap * (b.cols - 1)) / b.cols)) || OFFICE_TILE_MIN_W;
  const tileHeight = Math.round((tileWidth * 9) / 16);
  return { cols: b.cols, rows, tileWidth, tileHeight, scroll: rows * tileHeight + gap * (rows - 1) > H };
}
