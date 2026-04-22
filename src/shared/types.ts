// ============================================================
// NeuroSustain — Core Domain Types
// Deterministic type system for ms-precision cognitive measurement
// ============================================================

/** The five cognitive pillars based on current neuroscience */
export type CognitivePillar =
  | 'WorkingMemory'
  | 'CognitiveFlexibility'
  | 'InhibitoryControl'
  | 'SustainedAttention'
  | 'ProcessingSpeed';

/** All available exercise types */
export type ExerciseType =
  | 'ReactionTime'
  | 'StroopTask'
  | 'NBackDual'
  | 'SetSwitching'
  | 'HighNumber'
  | 'SerialSubtraction'
  | 'PianoPlayer'
  | 'WordScramble'
  | 'CPT'
  | 'BlockCount3D'
  | 'SemanticLinker'
  | 'ContextSwitcher'
  | 'PatternBreaker'
  | 'FreeDraw';

/** Session configuration passed to engine on start */
export interface SessionConfig {
  /** Difficulty level 1-10 controlling procedural generation */
  difficulty: number;
  /** Input modality preference */
  inputMode: 'keyboard' | 'touch' | 'auto';
  /** If true, this is a Neural Storm session — FSRS won't record */
  neuralStorm?: boolean;
}

/** Single trial result — the atomic unit of measurement */
export interface Trial {
  id?: number;
  sessionId: string;
  exerciseType: ExerciseType;
  pillar: CognitivePillar;
  timestamp: number;
  difficulty: number;
  isCorrect: boolean;
  reactionTimeMs: number;
  metadata: Record<string, unknown>;
}

/** Aggregated session summary */
export interface Session {
  id?: number;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  pillar: CognitivePillar;
  exerciseType: ExerciseType;
  trialCount: number;
  accuracy: number;
  meanReactionTimeMs: number;
  cvReactionTime: number;
  difficultyStart: number;
  difficultyEnd: number;
  focusScore: number;
}

/** Glicko-2 rating per cognitive pillar */
export interface PillarRating {
  pillar: CognitivePillar;
  rating: number;
  rd: number;
  volatility: number;
  lastUpdated: number;
}

/** FSRS card state per exercise-pillar combination */
export interface FsrsCard {
  id?: number;
  exerciseType: ExerciseType;
  pillar: CognitivePillar;
  stability: number;
  difficulty: number;
  retrievability: number;
  repetitions: number;
  interval: number;
  nextReviewDate: number;
  lastReviewDate: number;
}

/** User profile stored locally */
export interface UserProfile {
  id?: number;
  createdAt: number;
  locale: Locale;
  totalSessions: number;
  currentStreak: number;
  longestStreak: number;
  lastSessionDate: string;
  audioFocusAmbience: boolean;
}

/** Weekly cognitive snapshot for PDF export */
export interface CognitiveSnapshot {
  id?: number;
  weekStart: string;
  weekEnd: string;
  pillarScores: Record<CognitivePillar, number>;
  totalSessions: number;
  avgAccuracy: number;
  avgReactionTimeMs: number;
  avgFocusScore: number;
}

/** Supported locales */
export type Locale = 'en' | 'es';

/** Exercise metadata for the training menu */
export interface ExerciseInfo {
  type: ExerciseType;
  primaryPillar: CognitivePillar;
  secondaryPillars: CognitivePillar[];
  nameKey: string;
  descriptionKey: string;
  iconGlyph: string;
  trialsPerSession: number;
  available: boolean;
}

/** Actionable insight for loading screens */
export interface NeuroscientificInsight {
  id: string;
  textKey: string;
  pillar: CognitivePillar | 'general';
  doi: string;
  actionable: boolean;
  variables?: string[];
}

/** Router route definition */
export interface Route {
  path: string;
  title: string;
  render: () => HTMLElement;
}

// EngineCallbacks defined below with fatigue extension

/** Aggregated trial results after a session */
export interface TrialResults {
  trials: Omit<Trial, 'id' | 'sessionId'>[];
  accuracy: number;
  meanReactionTimeMs: number;
  sdReactionTimeMs: number;
  cvReactionTime: number;
  focusScore: number;
  exerciseType: ExerciseType;
  pillar: CognitivePillar;
}

// ── System A: Hardware Calibration ─────────────────────────

/** Hardware latency profile measured at first launch */
export interface HardwareProfile {
  id?: number;
  measuredAt: number;
  /** Raw inter-click intervals from the calibration tap test (ms) */
  rawIntervals: number[];
  /** Timer resolution estimate (minimum detectable delta, ms) */
  timerResolutionMs: number;
  /** Standard deviation of inter-click intervals — noise floor */
  jitterSdMs: number;
  /** Estimated display frame budget error (ms) */
  frameErrorMs: number;
  /** Calibration grade: 'excellent' | 'good' | 'fair' | 'poor' */
  grade: HardwareGrade;
  /** Warning shown to user if grade is 'fair' or 'poor' */
  warningShown: boolean;
}

export type HardwareGrade = 'excellent' | 'good' | 'fair' | 'poor';

// ── System B: Fatigue Detection ─────────────────────────────

/** Payload emitted when the EMA fatigue threshold is crossed */
export interface FatigueEvent {
  trialNumber: number;
  baselineEmaMs: number;
  currentEmaMs: number;
  risePercent: number;
}

// ── System C: FSRS Journal / Crash Recovery ─────────────────

/** Journal entry written before FSRS Worker dispatch, used for crash recovery */
export interface FsrsJournalEntry {
  id?: number;
  /** Matches the FSRS Worker requestId for tracing */
  sessionId: string;
  exerciseType: ExerciseType;
  pillar: CognitivePillar;
  accuracy: number;
  focusScore: number;
  cvReactionTime: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

// ── Extended EngineCallbacks (with fatigue) ──────────────────

/** Engine lifecycle callbacks — extended with fatigue signal */
export interface EngineCallbacks {
  onTrialComplete: (trial: Omit<Trial, 'id' | 'sessionId'>) => void;
  onSessionComplete: (results: TrialResults) => void;
  onExit: () => void;
  /** Fired when EMA rises ≥20% above the baseline — optional */
  onFatigueDetected?: (event: FatigueEvent) => void;
}
