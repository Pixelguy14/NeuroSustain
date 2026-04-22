// ============================================================
// NeuroSustain — FSRS Worker Bridge (Main Thread)
//
// Manages the Web Worker lifecycle and wraps postMessage into
// clean, Promise-based async calls.
//
// Design decisions:
//   - Singleton: one worker instance for the app lifetime
//   - Promise wrapping with per-request IDs (concurrent-safe)
//   - 5s timeout fallback: runs FSRS synchronously on main thread
//   - Journaling: writes a 'pending' entry to IndexedDB before
//     dispatching to the Worker, marks 'completed' after.
//     On boot, orphaned 'pending' entries are recovered.
// ============================================================

import type { FsrsCard, ExerciseType, CognitivePillar, Trial } from '@shared/types.ts';
import type { FsrsWorkerRequest, FsrsWorkerResponse } from './fsrs-worker-types.ts';
import { process_review, create_fsrs_card, derive_rating, get_current_retrievability } from '@core/fsrs/fsrs-algorithm.ts';
import { db } from '@shared/db.ts';
import { generate_uuid } from '@shared/utils.ts';

const WORKER_TIMEOUT_MS = 5000;

interface PendingRequest {
  resolve: (response: FsrsWorkerResponse) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

class FsrsBridge {
  private _worker: Worker | null = null;
  private _pending: Map<string, PendingRequest> = new Map();

  /** Lazily spawn the Web Worker */
  private _ensure_worker(): void {
    if (this._worker !== null) return;

    try {
      this._worker = new Worker(
        new URL('../../workers/fsrs.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this._worker.addEventListener('message', (e: MessageEvent<FsrsWorkerResponse>) => {
        this._handle_response(e.data);
      });

      this._worker.addEventListener('error', (e: ErrorEvent) => {
        console.error('[FsrsBridge] Worker error:', e.message);
        this._reject_all_pending(`Worker error: ${e.message}`);
        this._worker?.terminate();
        this._worker = null;
      });
    } catch (err) {
      console.warn('[FsrsBridge] Web Worker unavailable — FSRS will run synchronously.', err);
    }
  }

  private _handle_response(response: FsrsWorkerResponse): void {
    if (response.type === 'ready') return; // Boot signal — no pending request

    const pending = this._pending.get(response.requestId);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this._pending.delete(response.requestId);

    if (response.type === 'error') {
      pending.reject(new Error(response.error ?? 'Unknown worker error'));
    } else {
      pending.resolve(response);
    }
  }

  private _reject_all_pending(reason: string): void {
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
      this._pending.delete(id);
    }
  }

  private _send_to_worker(request: FsrsWorkerRequest): Promise<FsrsWorkerResponse> {
    this._ensure_worker();

    if (!this._worker) {
      return Promise.resolve(this._sync_fallback(request));
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this._pending.delete(request.requestId);
        console.warn('[FsrsBridge] Worker timeout — falling back to sync execution');
        resolve(this._sync_fallback(request));
      }, WORKER_TIMEOUT_MS);

      this._pending.set(request.requestId, { resolve, reject, timeoutId });
      this._worker!.postMessage(request);
    });
  }

  /** Synchronous FSRS fallback — runs on main thread if Worker is unavailable */
  private _sync_fallback(request: FsrsWorkerRequest): FsrsWorkerResponse {
    const startTime = performance.now();
    try {
      const rating = derive_rating(request.accuracy, request.focusScore, request.cvReactionTime);
      const card: FsrsCard = request.currentCard ?? {
        ...create_fsrs_card(request.exerciseType, request.pillar),
        id: undefined,
      };
      const retrievabilityAtSession = get_current_retrievability(card);
      const reviewResult = process_review(card, rating);

      return {
        type: 'recalibrated',
        requestId: request.requestId,
        updatedCard: reviewResult.card,
        scheduledDays: reviewResult.scheduledDays,
        retrievabilityAtSession,
        derivedRating: rating,
        processingTimeMs: performance.now() - startTime,
      };
    } catch (err) {
      return {
        type: 'error',
        requestId: request.requestId,
        error: err instanceof Error ? err.message : 'Sync fallback error',
      };
    }
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Recalibrate the FSRS card for a completed session.
   * Writes a journal entry before dispatching so crashes are recoverable.
   */
  async recalibrate_after_session(
    exerciseType: ExerciseType,
    pillar: CognitivePillar,
    accuracy: number,
    focusScore: number,
    cvReactionTime: number,
    trials: Trial[]
  ): Promise<{ scheduledDays: number; derivedRating: number; retrievability: number }> {
    const currentCard = await db.fsrsCards
      .where('[exerciseType+pillar]')
      .equals([exerciseType, pillar])
      .first() ?? null;

    const requestId = generate_uuid();

    // ── System C: Write journal entry BEFORE dispatching ──
    const journalId = await db.fsrsJournal.add({
      sessionId: requestId,
      exerciseType,
      pillar,
      accuracy,
      focusScore,
      cvReactionTime,
      status: 'pending',
      createdAt: Date.now(),
    });

    const request: FsrsWorkerRequest = {
      type: 'recalibrate',
      requestId,
      exerciseType,
      pillar,
      accuracy,
      focusScore,
      cvReactionTime,
      currentCard,
      trials,
    };

    try {
      const response = await this._send_to_worker(request);

      if (response.type === 'error' || !response.updatedCard) {
        await db.fsrsJournal.update(journalId, { status: 'failed', completedAt: Date.now() });
        throw new Error(`FSRS recalibration failed: ${response.error}`);
      }

      await this._persist_card(response.updatedCard, currentCard?.id);

      // ── Mark journal as completed ──
      await db.fsrsJournal.update(journalId, { status: 'completed', completedAt: Date.now() });

      console.debug(
        `[FSRS] ${exerciseType} | ` +
        `Rating: ${response.derivedRating} | ` +
        `Next: ${response.scheduledDays}d | ` +
        `S: ${response.updatedCard.stability.toFixed(2)} | ` +
        `${response.processingTimeMs?.toFixed(1)}ms`
      );

      return {
        scheduledDays:  response.scheduledDays ?? 1,
        derivedRating:  response.derivedRating ?? 3,
        retrievability: response.retrievabilityAtSession ?? 1.0,
      };
    } catch (err) {
      await db.fsrsJournal.update(journalId, { status: 'failed', completedAt: Date.now() });
      throw err;
    }
  }

  /** Persist the updated card state to IndexedDB */
  private async _persist_card(card: FsrsCard, existingId: number | undefined): Promise<void> {
    if (existingId !== undefined) {
      await db.fsrsCards.update(existingId, {
        stability:      card.stability,
        difficulty:     card.difficulty,
        retrievability: card.retrievability,
        repetitions:    card.repetitions,
        interval:       card.interval,
        nextReviewDate: card.nextReviewDate,
        lastReviewDate: card.lastReviewDate,
      });
    } else {
      await db.fsrsCards.add({ ...card, id: undefined });
    }
  }

  /** Get all due FSRS cards */
  async get_due_exercises(): Promise<FsrsCard[]> {
    return db.fsrsCards.where('nextReviewDate').belowOrEqual(Date.now()).toArray();
  }

  /** Get retrievability for a specific exercise */
  async get_retrievability(exerciseType: ExerciseType, pillar: CognitivePillar): Promise<number> {
    const card = await db.fsrsCards
      .where('[exerciseType+pillar]')
      .equals([exerciseType, pillar])
      .first();
    if (!card) return 1.0;
    return get_current_retrievability(card);
  }

  terminate(): void {
    this._worker?.terminate();
    this._worker = null;
  }
}

export const fsrsBridge = new FsrsBridge();
