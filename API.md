# NeuroSustain: Internal API & Module Interfaces

NeuroSustain is a strictly local-first application. It does not expose HTTP/REST endpoints to the internet. Instead, this document outlines the internal, decoupled module interfaces (APIs) that allow the presentation layer, the core logic layer, and the persistence layer to communicate deterministically.

## 1. Persistence Layer API (`src/shared/db.ts`)

Managed via Dexie.js, this interface acts as the asynchronous boundary between the application state and IndexedDB.

### Core Methods

*   `initialize_db(): Promise<void>`
    *   Bootstraps the IndexedDB schema. Creates default user profile and baseline Glicko-2 ratings if the database is empty.
*   `save_session(session: Session, trials: Trial[]): Promise<void>`
    *   **Transaction:** Atomically writes the aggregated session summary and the raw trial data.
    *   **Side Effect:** Evaluates streak logic and updates the `UserProfile.currentStreak` and `lastSessionDate`.
*   `get_profile(): Promise<UserProfile | undefined>`
    *   Retrieves the current user profile, including locale preferences and aggregate statistics.
*   `get_ratings(): Promise<PillarRating[]>`
    *   Retrieves the user's current Glicko-2 ratings across all 5 cognitive pillars.
*   `get_recent_sessions(count: number): Promise<Session[]>`
    *   Fetches the `n` most recent session summaries for dashboard visualization.

## 2. Analytics Engine API (`src/core/analytics/analytics.ts`)

A suite of pure, synchronous functions. These functions have no side effects and no DOM dependencies, making them highly testable.

### Core Methods

*   `compute_cv(values: number[]): number`
    *   **Input:** An array of raw reaction times (in milliseconds).
    *   **Output:** The Coefficient of Variation (`σ/μ`).
*   `compute_focus_score(accuracy: number, cv: number): number`
    *   **Input:** Accuracy ratio (0.0-1.0) and computed CV.
    *   **Output:** A normalized score (0-10) reflecting the quality of sustained attention.
*   `filter_valid_rts(reactionTimes: number[]): number[]`
    *   **Input:** Raw reaction times.
    *   **Output:** Array stripped of anticipatory responses (< 100ms) and misses (> 3000ms).
*   `detect_fatigue(cv: number): boolean`
    *   **Input:** The session's CV.
    *   **Output:** Boolean indicating if the CV exceeds the `FATIGUE_CV_THRESHOLD` (0.35).

## 3. Engine Callbacks API (`src/shared/types.ts`)

To ensure strict decoupling, Exercise Engines (Canvas renderers) never interact with the database directly. They communicate back to the Application Shell via the `EngineCallbacks` interface.

### The Interface

```typescript
export interface EngineCallbacks {
  // Fired immediately after a user completes a single atomic action (e.g., pressing SPACE).
  // Used by the shell for potential real-time HUD updates.
  onTrialComplete: (trial: Omit<Trial, 'id' | 'sessionId'>) => void;

  // Fired when the engine has completed all requested trials for the session.
  // Hands off the aggregated statistics to the shell for persistence and rendering results.
  onSessionComplete: (results: TrialResults) => void;

  // Fired if the user prematurely aborts the exercise.
  onExit: () => void;
}
```

## 4. Spaced Repetition Worker API (`src/workers/fsrs.worker.ts`)

Communication with the FSRS engine occurs across the Web Worker boundary via asynchronous message passing to protect the main thread.

### Message Protocols

**Request (Main Thread -> Worker):**
```typescript
interface FsrsWorkerRequest {
  type: 'recalibrate';
  trials: Trial[]; // Full history of trials for a specific exercise type
  currentCards: FsrsCard[]; // Current stability/difficulty states
}
```

**Response (Worker -> Main Thread):**
```typescript
interface FsrsWorkerResponse {
  type: 'recalibrated';
  updatedCards: FsrsCard[]; // New states with updated review intervals
  processingTimeMs: number; // For performance monitoring
}
```

## 5. Localization API (`src/shared/i18n.ts`)

Provides reactive, runtime translation capabilities.

### Core Methods

*   `init_i18n(): Promise<void>`
    *   Loads initial JSON dictionaries based on `UserProfile` preference or navigator language.
*   `set_locale(locale: Locale): Promise<void>`
    *   Fetches the new dictionary, updates the database preference, and triggers all subscribed listeners.
*   `t(key: string, vars?: Record<string, string | number>): string`
    *   Synchronous translation retrieval with template interpolation support.
*   `on_locale_change(fn: () => void): () => void`
    *   Pub/Sub mechanism allowing UI components (like the Sidebar) to re-render automatically when the language changes. Returns an unsubscribe function.
