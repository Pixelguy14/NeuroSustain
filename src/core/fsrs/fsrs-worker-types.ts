// ============================================================
// NeuroSustain — FSRS Worker Message Protocol
// Shared types imported by both the Worker and the main-thread bridge.
// Kept in a separate file so TS can resolve them without crossing
// the Worker module boundary.
// ============================================================

import type { FsrsCard, ExerciseType, CognitivePillar, Trial } from '../../shared/types.ts';

/** A single session's performance payload sent to the worker */
export interface FsrsWorkerRequest {
  type: 'recalibrate';
  requestId: string;
  exerciseType: ExerciseType;
  pillar: CognitivePillar;
  accuracy: number;
  focusScore: number;
  cvReactionTime: number;
  currentCard: FsrsCard | null;
  trials: Trial[];
}

/** Worker's response after recalibration */
export interface FsrsWorkerResponse {
  type: 'recalibrated' | 'error' | 'ready';
  requestId: string;
  updatedCard?: FsrsCard;
  scheduledDays?: number;
  retrievabilityAtSession?: number;
  derivedRating?: number;
  processingTimeMs?: number;
  error?: string;
}
