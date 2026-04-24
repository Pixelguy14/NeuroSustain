// ============================================================
// NeuroSustain — FSRS Algorithm (Pure Implementation)
// Free Spaced Repetition Scheduler v4
//
// References:
//   Wozniak, P.A. (1990). "Optimization of learning"
//   Ye, J. (2022). "FSRS4Anki — A modern spaced repetition algorithm"
//   DOI: https://github.com/open-spaced-repetition/fsrs4anki/wiki
//
// ZERO DOM dependency — safe to run in Web Worker or Node.js
// ============================================================

import type { FsrsCard, ExerciseType, CognitivePillar } from '../../shared/types.ts';

// ── FSRS Rating ────────────────────────────────────────────
// Maps cognitive performance into FSRS rating buckets
export type FsrsRating = 1 | 2 | 3 | 4;
export const RATING = {
  AGAIN: 1, // Complete failure — forgot/wrong + slow
  HARD:  2, // Incorrect or very slow — significant difficulty
  GOOD:  3, // Correct with noticeable effort
  EASY:  4, // Correct, fast, effortless
} as const;

// ── FSRS v4 Parameters ─────────────────────────────────────
// These are the default weights trained on Anki's 900M review dataset.
// Will be replaced with NeuroSustain-specific optimized weights in Sprint 4.
const W = [
  0.4072, // w0
  1.1829, // w1
  3.1262, // w2
  15.4722,// w3
  7.2102, // w4
  0.5316, // w5
  1.0651, // w6
  0.0589, // w7
  1.5330, // w8  (hard penalty multiplier)
  0.1544, // w9  (easy reward multiplier)
  1.0050, // w10
  1.9395, // w11
  0.1100, // w12
  0.2900, // w13
  2.2700, // w14
  0.0700, // w15
  2.9898, // w16
  0.5100, // w17
] as const;

/** Target Retrievability threshold — reviews are scheduled when R drops to this */
const DESIRED_RETENTION = 0.9;

// ── FSRS Card Defaults ─────────────────────────────────────
export const FSRS_CARD_DEFAULTS = {
  stability:       1.0,
  difficulty:      5.0,    // Scale: 1 (easy) – 10 (hard)
  retrievability:  1.0,
  repetitions:     0,
  interval:        0,
  nextReviewDate:  Date.now(),
  lastReviewDate:  0,
} as const;

// ── Types for the algorithm ─────────────────────────────────
export interface FsrsReviewResult {
  card: FsrsCard;
  scheduledDays: number;
  retrievabilityAtReview: number;
}

// ── Core Algorithm ─────────────────────────────────────────

/**
 * Compute initial stability after the very first review, based on rating.
 * S₀(r) = W[r-1]  (for r ∈ {1,2,3,4})
 */
function initial_stability(rating: FsrsRating): number {
  // W[0]..W[3] are the four initial stability values
  const w = W[rating - 1];
  return w !== undefined ? Math.max(0.1, w) : 1.0;
}

/**
 * Compute initial difficulty based on first rating.
 * D₀(r) = W[4] - exp(W[5] * (r - 1)) + 1
 */
function initial_difficulty(rating: FsrsRating): number {
  const d = W[4] - Math.exp(W[5] * (rating - 1)) + 1;
  return clamp_difficulty(d);
}

/**
 * Compute current Retrievability.
 * R(t, S) = (1 + FACTOR * t / S) ^ -1
 * where FACTOR = (1 / DESIRED_RETENTION)^(1/c) - 1, c = 19/81
 */
function compute_retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  const FACTOR = Math.pow(1 / DESIRED_RETENTION, 1 / (19 / 81)) - 1;
  return Math.pow(1 + FACTOR * (elapsedDays / stability), -(19 / 81));
}

/**
 * Compute mean reversion factor for difficulty.
 * Ensures difficulty doesn't permanently converge to extremes.
 */
function mean_reversion(d: number): number {
  return W[7] * (W[4] - d);
}

/**
 * Difficulty next value after a review.
 * D'(D, r) = D - W[6] * (r - 3) + meanReversion
 */
function next_difficulty(d: number, rating: FsrsRating): number {
  const delta = -W[6] * (rating - 3);
  const newD = d + delta + mean_reversion(d);
  return clamp_difficulty(newD);
}

/**
 * Short-term stability after a failed recall (Again).
 * S_r' = W[11] * D^(-W[12]) * ((S+1)^W[13] - 1) * exp(W[14] * (1-R))
 */
function stability_after_forgetting(d: number, s: number, r: number): number {
  return W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
}

/**
 * Recall stability after a successful review.
 * S_r' = S * exp(W[8]) * (11 - D) * S^(-W[9]) * (exp(W[10] * (1-R)) - 1) * hardPenalty * easyBonus + S
 */
function stability_after_recall(d: number, s: number, r: number, rating: FsrsRating): number {
  const hardPenalty = rating === RATING.HARD ? W[15] : 1.0;
  const easyBonus   = rating === RATING.EASY ? W[16] : 1.0;

  const factor = Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1);
  return s * factor * hardPenalty * easyBonus + s;
}

/** Compute the next interval from stability, targeting desired retention */
function compute_interval(stability: number): number {
  const interval = (stability / DESIRED_RETENTION) * Math.log(DESIRED_RETENTION);
  // Alternate precise formula: next interval = S * ln(R_desired) / ln(0.9)
  const precise = stability * Math.log(DESIRED_RETENTION) / Math.log(0.9);
  void interval; // Use precise formula
  return Math.max(1, Math.round(precise));
}

/** Clamp difficulty to valid range 1-10 */
function clamp_difficulty(d: number): number {
  return Math.max(1, Math.min(10, d));
}

// ── Public API ─────────────────────────────────────────────

/**
 * Create a new default FSRS card for a given exercise + pillar pair.
 * Called on first encounter of any exercise.
 */
export function create_fsrs_card(
  exerciseType: ExerciseType,
  pillar: CognitivePillar
): Omit<FsrsCard, 'id'> {
  return {
    exerciseType,
    pillar,
    ...FSRS_CARD_DEFAULTS,
    nextReviewDate: Date.now(),
    lastReviewDate: 0,
  };
}

/**
 * Process a single FSRS review and compute the updated card state.
 *
 * @param card    - Current card state from IndexedDB
 * @param rating  - Performance rating (1=Again, 2=Hard, 3=Good, 4=Easy)
 * @param nowMs   - Current timestamp (default: Date.now())
 * @returns       - Updated card + scheduling metadata
 */
export function process_review(
  card: FsrsCard,
  rating: FsrsRating,
  nowMs: number = Date.now()
): FsrsReviewResult {
  const now = nowMs;
  const elapsedMs = card.lastReviewDate > 0 ? now - card.lastReviewDate : 0;
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  let newStability: number;
  let newDifficulty: number;
  const currentR = card.lastReviewDate > 0
    ? compute_retrievability(elapsedDays, card.stability)
    : 1.0;

  if (card.repetitions === 0) {
    // ── First review ──
    newStability  = initial_stability(rating);
    newDifficulty = initial_difficulty(rating);
  } else if (rating === RATING.AGAIN) {
    // ── Forgetting event ──
    newStability  = stability_after_forgetting(card.difficulty, card.stability, currentR);
    newDifficulty = next_difficulty(card.difficulty, rating);
  } else {
    // ── Successful recall ──
    newStability  = stability_after_recall(card.difficulty, card.stability, currentR, rating);
    newDifficulty = next_difficulty(card.difficulty, rating);
  }

  const scheduledDays = compute_interval(newStability);
  const nextReviewDate = now + scheduledDays * 24 * 60 * 60 * 1000;

  const updatedCard: FsrsCard = {
    ...card,
    stability:       newStability,
    difficulty:      newDifficulty,
    retrievability:  compute_retrievability(0, newStability), // Fresh retrieval
    repetitions:     card.repetitions + 1,
    interval:        scheduledDays,
    nextReviewDate,
    lastReviewDate:  now,
  };

  return {
    card:                  updatedCard,
    scheduledDays,
    retrievabilityAtReview: currentR,
  };
}

/**
 * Derive an FSRS rating from a session's cognitive metrics.
 *
 * This maps NeuroSustain's precision metrics to the FSRS rating scale,
 * ensuring the spaced repetition system reflects true cognitive performance
 * rather than subjective self-assessment.
 *
 * @param accuracy   - Session accuracy (0.0 - 1.0)
 * @param focusScore - Normalized focus score (0 - 10)
 * @param cvReactionTime - Coefficient of variation (0.0+)
 * @param meanDifficulty - Average difficulty navigated during staircase (1-10)
 * @param baselineDifficulty - User's Glicko-2 difficulty level (1-10)
 */
export function derive_rating(
  accuracy: number,
  focusScore: number,
  cvReactionTime: number,
  meanDifficulty: number,
  baselineDifficulty: number
): FsrsRating {
  // Weight: accuracy is the primary signal, focus score and CV refine it
  const accuracyScore = accuracy;             // 0.0 - 1.0
  const focusNorm     = focusScore / 10;      // 0.0 - 1.0
  const cvPenalty     = Math.min(1, cvReactionTime / 0.5); // 0.0 - 1.0 (higher CV = worse)

  // Difficulty adjustment: Reward for pushing boundaries, penalize for retreating
  // A delta of +2 (expert) adds 0.1 to composite; -2 (struggling) subtracts 0.1.
  const diffDelta = meanDifficulty - baselineDifficulty;
  const diffBonus = (diffDelta / 10) * 0.5; // Scale: -0.5 to +0.5 max impact

  const composite = (accuracyScore * 0.50) + (focusNorm * 0.25) - (cvPenalty * 0.15) + (diffBonus * 0.10);

  if      (composite >= 0.85) return RATING.EASY;   // Mastering high difficulty
  else if (composite >= 0.65) return RATING.GOOD;   // Solid performance
  else if (composite >= 0.45) return RATING.HARD;   // Struggled or needed down-scaling
  else                         return RATING.AGAIN;  // Failed / severe fatigue
}

/**
 * Get all due cards from a list (i.e., where nextReviewDate <= now).
 */
export function get_due_cards(cards: FsrsCard[], nowMs: number = Date.now()): FsrsCard[] {
  return cards.filter(c => c.nextReviewDate <= nowMs);
}

/**
 * Compute estimated retrievability for a card at a given point in time.
 */
export function get_current_retrievability(card: FsrsCard, nowMs: number = Date.now()): number {
  if (card.lastReviewDate === 0) return 1.0;
  const elapsedDays = (nowMs - card.lastReviewDate) / (1000 * 60 * 60 * 24);
  return compute_retrievability(elapsedDays, card.stability);
}
