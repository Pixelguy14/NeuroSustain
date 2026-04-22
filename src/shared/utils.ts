// ============================================================
// NeuroSustain — Utilities
// Timing, random, and UUID helpers for deterministic measurement
// ============================================================

/** High-resolution timestamp using performance.now() */
export function precise_now(): number {
  return performance.now();
}

/** Generate a UUID v4 for session identification */
export function generate_uuid(): string {
  return crypto.randomUUID();
}

/** Random integer in range [min, max] inclusive */
export function random_int(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in range [min, max) */
export function random_float(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Format milliseconds to display string */
export function format_ms(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Get today's date as YYYY-MM-DD */
export function today_iso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Debounce a function */
export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeout: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  }) as T;
}

/** Shuffle an array in-place */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i]!;
    array[i] = array[j]!;
    array[j] = temp;
  }
  return array;
}
