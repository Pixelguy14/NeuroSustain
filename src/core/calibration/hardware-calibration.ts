// ============================================================
// NeuroSustain — Hardware Calibration (Pure Math)
// Measures the user's system timing noise floor.
//
// The Problem: performance.now() is spec'd at 5μs precision but
// browsers round it to ~1ms (Spectre mitigation). A 60Hz monitor
// adds up to 16.6ms of presentation jitter. Together they form
// a "noise floor" beneath which reaction time differences are
// indistinguishable from hardware artifact.
//
// The Solution: A rapid tap test (10 clicks on a static target)
// measures the distribution of inter-click intervals under
// controlled conditions. The SD of those intervals is our
// empirical noise floor — no assumptions, just measurement.
// ============================================================

import type { HardwareProfile, HardwareGrade } from '../../shared/types.ts';
import { t } from '../../shared/i18n.ts';

/** Minimum number of taps required for a valid calibration */
export const CALIBRATION_TAPS = 10;

/**
 * Measure the timer's effective resolution by sampling performance.now()
 * in a tight loop and finding the minimum non-zero delta.
 * Browsers typically return 1ms or 0.1ms depending on security settings.
 */
export function measure_timer_resolution(): number {
  const samples = 200;
  let minDelta = Infinity;
  let prev = performance.now();

  for (let i = 0; i < samples; i++) {
    const now = performance.now();
    const delta = now - prev;
    if (delta > 0 && delta < minDelta) {
      minDelta = delta;
    }
    prev = now;
  }

  return minDelta === Infinity ? 1.0 : minDelta;
}

/**
 * Estimate the display frame budget error from the current refresh rate.
 * Uses a short rAF sampling window to detect the actual frame period.
 */
export function measure_frame_period(): Promise<number> {
  return new Promise(resolve => {
    const samples: number[] = [];
    let lastTime = performance.now();
    let count = 0;

    function sample(timestamp: number): void {
      samples.push(timestamp - lastTime);
      lastTime = timestamp;
      count++;

      if (count < 10) {
        requestAnimationFrame(sample);
      } else {
        // Remove outliers (first frame can be slow)
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 16.6;
        resolve(Math.round(median * 10) / 10);
      }
    }

    requestAnimationFrame(sample);
  });
}

/**
 * Compute hardware calibration stats from raw inter-click intervals.
 *
 * @param intervals - Array of ms between successive click timestamps
 * @param timerResolutionMs - From measure_timer_resolution()
 * @param frameErrorMs      - From measure_frame_period()
 */
export function analyze_calibration(
  intervals: number[],
  timerResolutionMs: number,
  frameErrorMs: number
): Omit<HardwareProfile, 'id' | 'warningShown'> {
  const n = intervals.length;
  if (n === 0) {
    throw new Error('No intervals to analyze');
  }

  // Mean
  const mean = intervals.reduce((s, v) => s + v, 0) / n;

  // Standard deviation (population)
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);

  // Grade based on jitter SD
  // SD < 5ms: excellent (timer noise floor, imperceptible to measurement)
  // SD < 20ms: good (sub-frame precision)
  // SD < 50ms: fair (1-3 frame error, warn user)
  // SD >= 50ms: poor (> 3 frames, measurements unreliable in absolute terms)
  let grade: HardwareGrade;
  if (sd < 5) {
    grade = 'excellent';
  } else if (sd < 20) {
    grade = 'good';
  } else if (sd < 50) {
    grade = 'fair';
  } else {
    grade = 'poor';
  }

  return {
    measuredAt: Date.now(),
    rawIntervals: intervals,
    timerResolutionMs,
    jitterSdMs: Math.round(sd * 100) / 100,
    frameErrorMs,
    grade,
  };
}

/** Human-readable grade description for the UI */
export function grade_description(grade: HardwareGrade): { label: string; color: string; warning: string | null } {
  switch (grade) {
    case 'excellent':
      return {
        label: t('calibration.result.excellent'),
        color: 'hsl(145, 65%, 50%)',
        warning: null,
      };
    case 'good':
      return {
        label: t('calibration.result.good'),
        color: 'hsl(175, 70%, 50%)',
        warning: null,
      };
    case 'fair':
      return {
        label: t('calibration.result.fair'),
        color: 'hsl(38, 90%, 55%)',
        warning: t('calibration.warning.fair', { ms: '20-50' }),
      };
    case 'poor':
      return {
        label: t('calibration.result.poor'),
        color: 'hsl(0, 75%, 55%)',
        warning: t('calibration.warning.poor'),
      };
  }
}
