// The arithmetic behind every paged list — no React, importable from server
// pages and client components alike. The controls live in pager.tsx.

export const PAGE_SIZE = 10;

/** Slice one page and say where you are. Out-of-range pages clamp. */
export function paginate<T>(
  items: T[],
  page: number,
  size = PAGE_SIZE,
): { rows: T[]; pages: number; page: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: items.slice((clamped - 1) * size, clamped * size), pages, page: clamped, total: items.length };
}

/** `?page=` as a number, 1 when missing or nonsense. */
export function pageFrom(param: string | string[] | undefined): number {
  const n = Number(Array.isArray(param) ? param[0] : param);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
