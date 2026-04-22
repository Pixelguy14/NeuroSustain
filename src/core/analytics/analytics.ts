// ============================================================
// NeuroSustain — Analytics Engine
// Statistical computations for cognitive performance analysis
// All functions are pure — zero side effects, zero DOM dependency
// ============================================================

import { TIMING } from '@shared/constants.ts';

/** Compute arithmetic mean */
export function compute_mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Compute standard deviation (population) */
export function compute_sd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = compute_mean(values);
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Compute Coefficient of Variation (CV = σ/μ)
 * A high CV indicates inconsistent performance → cognitive fatigue
 */
export function compute_cv(values: number[]): number {
  if (values.length < TIMING.MIN_TRIALS_FOR_CV) return 0;
  const mean = compute_mean(values);
  if (mean === 0) return 0;
  return compute_sd(values) / mean;
}

/** Compute accuracy as ratio of correct trials */
export function compute_accuracy(correct: number, total: number): number {
  if (total === 0) return 0;
  return correct / total;
}

/**
 * Compute Focus Score — quality-weighted attention metric
 * focusScore = accuracy × (1 / CV)
 * High accuracy + low variability = deep focus
 */
export function compute_focus_score(accuracy: number, cv: number): number {
  if (cv <= 0) return accuracy * 10; // Perfect consistency edge case
  const rawScore = accuracy * (1 / cv);
  // Normalize to ~0-10 scale
  return Math.min(10, Math.max(0, rawScore));
}

/** Filter out anticipatory responses (< 100ms) and misses (> 3000ms) */
export function filter_valid_rts(reactionTimes: number[]): number[] {
  return reactionTimes.filter(
    rt => rt >= TIMING.MIN_REACTION_MS && rt <= TIMING.MAX_REACTION_MS
  );
}

/** Detect if current CV indicates cognitive fatigue */
export function detect_fatigue(cv: number): boolean {
  return cv > TIMING.FATIGUE_CV_THRESHOLD;
}

/** Compute percentile rank for a value within a dataset */
export function compute_percentile(value: number, dataset: number[]): number {
  if (dataset.length === 0) return 50;
  const sorted = [...dataset].sort((a, b) => a - b);
  const index = sorted.findIndex(v => v >= value);
  if (index === -1) return 100;
  return Math.round((index / sorted.length) * 100);
}
