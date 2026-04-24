// ============================================================
// NeuroSustain — Glicko-2 Skill Rating System
// "Phantom Opponent" Adaptation for Cognitive Performance
// ============================================================

import { GLICKO2_DEFAULTS } from '../../shared/constants.ts';
import type { PillarRating } from '../../shared/types.ts';

/**
 * Glicko-2 implementation adapted for single-player cognitive tests.
 * The "opponent" is the difficulty level of the test itself.
 * 
 * References: http://www.glicko.net/glicko/glicko2.pdf
 */

const MULTIPLIER = 173.7178;

/** Convert mean difficulty (1-10) to a Glicko-2 rating scale */
export function difficulty_to_rating(meanDifficulty: number): number {
  // Level 1  => 1300 (Novice)
  // Level 10 => 2200 (Grandmaster)
  return 1300 + (meanDifficulty - 1) * 100;
}

/** Update a pillar rating based on session performance */
export function update_pillar_rating(
  current: PillarRating,
  opponentRating: number,
  score: number // Combined accuracy/focus (0.0 to 1.0)
): PillarRating {
  const tau = GLICKO2_DEFAULTS.TAU;

  // Step 2: Convert to Glicko-2 scale
  const mu = (current.rating - 1500) / MULTIPLIER;
  const phi = current.rd / MULTIPLIER;
  const sigma = current.volatility;

  const muOpponent = (opponentRating - 1500) / MULTIPLIER;
  // We assume the "Difficulty Level" has a fixed certainty (RD)
  const phiOpponent = 100 / MULTIPLIER; 

  // Step 3 & 4: Compute estimated variance and delta
  const g_phi = 1 / Math.sqrt(1 + (3 * phiOpponent * phiOpponent) / (Math.PI * Math.PI));
  const E = 1 / (1 + Math.exp(-g_phi * (mu - muOpponent)));
  
  const v = 1 / (g_phi * g_phi * E * (1 - E));
  const delta = v * g_phi * (score - E);

  // Step 5: Iterative volatility update
  const a = Math.log(sigma * sigma);
  const epsilon = 0.000001;
  let A = a;
  let B: number;

  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau, delta, phi, v, a, tau) < 0) {
      k++;
    }
    B = a - k * tau;
  }

  let fA = f(A, delta, phi, v, a, tau);
  let fB = f(B, delta, phi, v, a, tau);

  while (Math.abs(B - A) > epsilon) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C, delta, phi, v, a, tau);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  const newSigma = Math.exp(A / 2);

  // Step 6: Update RD and Rating
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * g_phi * (score - E);

  return {
    pillar: current.pillar,
    rating: newMu * MULTIPLIER + 1500,
    rd: newPhi * MULTIPLIER,
    volatility: newSigma,
    lastUpdated: Date.now(),
  };
}

/** Helper function for volatility iteration */
function f(x: number, delta: number, phi: number, v: number, a: number, tau: number): number {
  const ex = Math.exp(x);
  const num1 = ex * (delta * delta - phi * phi - v);
  const den1 = 2 * (phi * phi + v + ex) * (phi * phi + v + ex);
  const term2 = (x - a) / (tau * tau);
  return (num1 / den1) - term2;
}
