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

/** Calculate focus score (0-10) based on accuracy and consistency */
export function compute_focus_score(accuracy: number, cv: number): number {
  const accPart = accuracy * 6; // Accuracy weighted 60%
  const cvPart = Math.max(0, 1 - cv) * 4; // Consistency weighted 40%
  return Math.min(10, accPart + cvPart);
}

/** Calculate percentile based on Glicko-2 rating (Normal Distribution) 
 *  Assuming Mean = 1500, SD = 300 (Standard Glicko-2 scaling)
 */
export function calculate_percentile(rating: number): number {
  const mean = 1500;
  const sd = 300;
  // Approximation of Normal CDF
  const z = (rating - mean) / sd;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  
  const percentile = z > 0 ? 1 - p : p;
  return Math.round(percentile * 100);
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
