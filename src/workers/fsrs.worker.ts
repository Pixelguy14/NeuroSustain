// ============================================================
// NeuroSustain — FSRS Web Worker Entry Point
//
// This file runs in a dedicated background thread.
// It receives session results from the main thread, runs the
// FSRS algorithm, and posts back updated card states.
//
// CRITICAL: This file MUST NOT import anything with DOM APIs.
// Only pure TypeScript + core algorithm modules allowed.
// ============================================================

import {
  process_review,
  create_fsrs_card,
  derive_rating,
  get_current_retrievability,
} from '../core/fsrs/fsrs-algorithm.ts';

import type { FsrsCard } from '../shared/types.ts';
import type { FsrsWorkerRequest, FsrsWorkerResponse } from '../core/fsrs/fsrs-worker-types.ts';

// ── Worker Message Handler ──────────────────────────────────

self.addEventListener('message', (event: MessageEvent<FsrsWorkerRequest>) => {
  const startTime = performance.now();
  const { type, requestId, exerciseType, pillar, accuracy, focusScore, cvReactionTime, meanDifficulty, currentCard, trials } = event.data;

  if (type !== 'recalibrate') {
    const errorResponse: FsrsWorkerResponse = {
      type: 'error',
      requestId,
      error: `Unknown message type: ${type}`,
    };
    self.postMessage(errorResponse);
    return;
  }

  try {
    // Step 1: Derive FSRS rating from session metrics (incorporating adaptive staircase performance)
    const rating = derive_rating(
      accuracy, 
      focusScore, 
      cvReactionTime, 
      meanDifficulty, 
      currentCard?.difficulty ?? 5.0
    );

    // Step 2: Get or create the card state
    const card: FsrsCard = currentCard ?? {
      ...(create_fsrs_card(exerciseType, pillar)),
      // Inject a temporary id for type compatibility (DB will assign real one)
      id: undefined,
    };

    // Step 3: Capture retrievability at the moment of session (before update)
    const retrievabilityAtSession = get_current_retrievability(card);

    // Step 4: Process the review with the FSRS algorithm
    const reviewResult = process_review(card, rating);

    // Step 5: Compute processing time for telemetry
    const processingTimeMs = performance.now() - startTime;

    const response: FsrsWorkerResponse = {
      type: 'recalibrated',
      requestId,
      updatedCard: reviewResult.card,
      scheduledDays: reviewResult.scheduledDays,
      retrievabilityAtSession,
      derivedRating: rating,
      processingTimeMs,
    };

    void trials; // Reserved for batch processing in Sprint 4 (weight optimization)

    self.postMessage(response);
  } catch (err: unknown) {
    const errorResponse: FsrsWorkerResponse = {
      type: 'error',
      requestId,
      error: err instanceof Error ? err.message : 'Unknown worker error',
    };
    self.postMessage(errorResponse);
  }
});

// Signals to the main thread that the worker booted successfully
self.postMessage({ type: 'ready', requestId: '__init__' });
