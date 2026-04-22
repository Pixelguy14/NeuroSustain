// ============================================================
// NeuroSustain — Latency Normalizer
// Strips hardware jitter and normalizes reaction times against
// dynamic difficulty scaling to protect FSRS retrievability.
// ============================================================

import { get_hardware_profile } from '@shared/db.ts';

/**
 * Strips the measured hardware jitter from the raw reaction time.
 * We subtract the timer resolution and 50% of the jitter SD to
 * prevent creating "biologically impossible" (negative or <100ms) times.
 */
export async function clean_reaction_time(rawRT: number): Promise<number> {
  const profile = await get_hardware_profile();
  if (!profile) return rawRT;

  const timerRes = profile.timerResolutionMs || 0;
  const jitterPenalty = (profile.jitterSdMs || 0) * 0.5;
  
  const cleanRT = rawRT - timerRes - jitterPenalty;
  
  // Floor to 100ms to prevent impossible values if hardware noise was artificially high
  return Math.max(100, cleanRT);
}

/**
 * Normalizes the cleaned RT using a logarithmic decay model.
 * Formula: WeightedRT = CleanRT / (1 + ln(Difficulty))
 * 
 * This heavily discounts initial difficulty leaps (e.g. lv 1 to 3)
 * where the learning curve is massive, but stabilizes at high levels (8-10)
 * so a high level doesn't artificially reward a slow time too much.
 */
export function compute_difficulty_weighted_rt(cleanRT: number, difficulty: number): number {
  if (difficulty < 1) difficulty = 1;
  
  // 1 + ln(1) = 1 (No scaling for level 1)
  // 1 + ln(2) = 1.69 (Significant scaling)
  // 1 + ln(10) = 3.3 (Max scaling)
  const scaleFactor = 1 + Math.log(difficulty);
  
  return cleanRT / scaleFactor;
}
