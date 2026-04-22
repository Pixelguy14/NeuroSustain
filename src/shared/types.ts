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
  | 'PianoPlayer'
  | 'WordScramble'
  | 'CPT'
  | 'BlockCount3D'
  | 'SemanticLinker'
  | 'ContextSwitcher'
  | 'PatternBreaker';

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

/** Engine lifecycle callbacks */
export interface EngineCallbacks {
  onTrialComplete: (trial: Omit<Trial, 'id' | 'sessionId'>) => void;
  onSessionComplete: (results: TrialResults) => void;
  onExit: () => void;
}

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
