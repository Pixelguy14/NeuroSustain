# NeuroSustain: System Architecture

**Live Application:** [https://pixelguy14.github.io/NeuroSustain/](https://pixelguy14.github.io/NeuroSustain/)

## Overview

NeuroSustain is a local-first Progressive Web App (PWA) designed to deliver evidence-based cognitive training with millisecond precision. The system architecture is built on a "Functional Modules" pattern, prioritizing strict decoupling between core logic (mathematical engines) and presentation layers (rendering/UI) to ensure high-performance, deterministic execution.

## Architectural Layers

### 1. Presentation Layer (UI & Rendering)

**Stack:** Vanilla TypeScript, Web Components, Canvas 2D API, Web Audio API, Three.js (lazy-loaded).

*   **App Shell (`src/ui`):** Built with pure Web Components (extending `HTMLElement`) and a CSS Grid "Bento Box" layout. This avoids the overhead of Virtual DOM reconciliation (React/Vue/Lit), ensuring UI updates do not cause frame drops during cognitive measurements. Includes a glassmorphic design system for premium visual fidelity without sacrificing performance.
*   **Exercise Engines (`src/engines`):** Rendered entirely via the Canvas 2D API. The Canvas provides direct pixel manipulation and avoids browser layout/reflow cycles. Engines inherit from `BaseEngine`, which standardizes the init/update/render/cleanup lifecycle. Recent optimizations include **Zero-Allocation rendering** (caching strings/styles) to ensure 60fps stability during intense cognitive loads.
*   **Neural Storm Orchestrator:** A specialized state machine in `src/ui/pages/session.ts` that manages rapid context-switching. It dynamically swaps engines every 30 seconds, monitoring cross-pillar fatigue and switch-costs in real-time.
*   **Routing:** A custom, minimal hash-based Single Page Application (SPA) router manages view transitions without triggering full page reloads.

### 2. Core Logic Layer (Mathematical Engines)

**Stack:** Pure TypeScript (zero DOM dependencies).

This layer is strictly isolated from the presentation layer. It handles all statistical analysis, procedural generation, and adaptive difficulty calculations.

*   **Analytics Engine (`src/core/analytics`):** Computes mean reaction times, standard deviations, and dual fatigue metrics (CV for overall variability and EMA for real-time drift detection).
*   **Input Bridge (`src/core/input`):** A normalization layer that treats physical keyboard events and touch/pointer events as identical sub-millisecond interrupts, essential for equitable reaction time tracking across devices.
*   **Audio Engine (`src/core/audio`):** Generates procedural feedback cues and focus-enhancing white noise via the Web Audio API, eliminating asset fetching delays and ensuring zero-latency auditory stimuli.
*   **Adaptive Difficulty:** A two-tier titration system:
    *   **Adaptive Staircase Procedure (Intra-session):** Implements a "3-Up, 1-Down" protocol. Users must chain 3 correct trials to advance 1 level, while a single error triggers an immediate level reduction. This ensures the cognitive load remains perfectly calibrated to the user's current state of fatigue and focus.
    *   **Glicko-2 "Phantom Opponent" (Intersession):** To adapt Glicko-2 for single-player use, the system treats the test difficulty as a "Phantom Opponent." Session performance updates the user's rating relative to the difficulty level reached, providing a mathematically robust baseline for future training.
*   **Spaced Repetition (`src/core/fsrs`):** Implements the Free Spaced Repetition Scheduler (FSRS).
    *   **Concurrency Model:** The FSRS engine runs in a dedicated **Web Worker**. Recalibrating stability and difficulty parameters across thousands of historical trials is computationally intensive. By moving this to a background thread, we guarantee that the main thread's frame budget is preserved, preventing UI stuttering or latency artifacts during active training sessions.

### 3. Persistence Layer (Local-First Data)

### 3. Analytics & Clinical Layer

**Engine:** Glicko-2 (Longitudinal skill tracking) + FSRS v4 (Spaced Repetition Scheduler).

*   **Clinical PDF Export:** Generates multi-page reports using `jsPDF` with longitudinal performance logs.
*   **Benchmarking Utility:** Uses a Normal Cumulative Distribution Function (Mean=1500, SD=300) to calculate global percentiles.
*   **Cloud Infrastructure:** Supabase (PostgreSQL) for cross-device session synchronization with Row Level Security (RLS).

### 4. Persistence & Infrastructure

**Stack:** IndexedDB, Dexie.js wrapper, Vite, Workbox.

*   **Philosophy:** NeuroSustain operates primarily local-first. While Supabase provides cross-device sync, the application remains fully functional offline via IndexedDB.
*   **Schema (`src/shared/db.ts`):** Managed via Dexie.js, storing atomic `Trial` data (with sub-millisecond timestamps), aggregated `Session` data, user profiles, and FSRS card states. 
*   **Crash Recovery:** Includes a **FSRS Journal** table. Recalibration requests are journaled before worker dispatch. If the browser is closed or crashes during calculation, the system automatically recovers and completes the update upon next boot.
*   **PWA Configuration:** Workbox handles the generation of the service worker, enabling offline functionality. Static assets (fonts, icons, HTML, JS) are cached using a Cache-First strategy.
*   **Module Bundling:** Vite provides lightning-fast Hot Module Replacement (HMR) during development and optimized tree-shaking for production builds.

## Redundancy & Fallbacks

Because NeuroSustain is fundamentally local-first, traditional "backend API redundancies" do not apply. However, the system includes internal resilience mechanisms:

1.  **Storage Quota Limits:** IndexedDB storage is finite. A background cleanup routine will eventually compress older trial data into daily/weekly aggregates to prevent hitting browser storage limits, ensuring the app remains functional indefinitely.
2.  **Graceful Degradation of Web Audio:** If the Web Audio API fails to initialize (e.g., due to restrictive browser auto-play policies or missing hardware), dual-task exercises (like N-Back Dual) gracefully degrade to visual-only modes, logging a warning rather than crashing the session.

## Key Design Decisions & Rationale

*   **Why TypeScript (Strict Mode) over JavaScript?** In a system measuring cognitive latency in milliseconds, data integrity is paramount. Strict typing prevents `undefined` values from cascading into mathematical engines (Glicko-2, FSRS) or Canvas coordinate calculations, ensuring deterministic execution.
*   **Why FSRS over SM-2?** While SuperMemo-2 (SM-2) is the classic spaced repetition algorithm, FSRS (Free Spaced Repetition Scheduler) utilizes machine learning to adapt to a user's specific forgetting curve. It tracks Stability, Difficulty, and Retrievability, generally resulting in 20-30% fewer required reviews for the same target retention rate.
*   **Why Canvas 2D over DOM for Exercises?** DOM updates (changing classes, styles, or nodes) trigger browser recalculate-style and layout (reflow) operations. These are unpredictable and can block the main thread for several milliseconds. The Canvas API bypasses this, allowing for pixel-perfect timing and guaranteeing that when `performance.now()` is called, it accurately reflects the moment the visual stimulus was rendered.
