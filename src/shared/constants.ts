// ============================================================
// NeuroSustain — Neuroscience Constants & Configuration
// ============================================================

import type { CognitivePillar, ExerciseInfo } from './types.ts';

/** Default Glicko-2 parameters */
export const GLICKO2_DEFAULTS = {
  INITIAL_RATING: 1500,
  INITIAL_RD: 350,
  INITIAL_VOLATILITY: 0.06,
  TAU: 0.5,
} as const;

/** Timing thresholds (milliseconds) */
export const TIMING = {
  /** Minimum plausible human reaction time — anything below is anticipation */
  MIN_REACTION_MS: 100,
  /** Maximum reaction time before trial is considered a miss */
  MAX_REACTION_MS: 3000,
  /** CV threshold above which fatigue is detected */
  FATIGUE_CV_THRESHOLD: 0.35,
  /** Minimum trials needed for reliable CV computation */
  MIN_TRIALS_FOR_CV: 5,
} as const;

/** Session configuration */
export const SESSION = {
  TRIALS_PER_SESSION: 20,
  /** Random stimulus delay range (ms) for Reaction Time */
  STIMULUS_DELAY_MIN_MS: 1000,
  STIMULUS_DELAY_MAX_MS: 4000,
} as const;

/** Pillar display metadata */
export const PILLAR_META: Record<CognitivePillar, { labelKey: string; color: string; angle: number }> = {
  WorkingMemory:       { labelKey: 'pillar.workingMemory',       color: 'hsl(175, 70%, 55%)', angle: -90 },
  CognitiveFlexibility:{ labelKey: 'pillar.cognitiveFlexibility', color: 'hsl(210, 70%, 60%)', angle: -18 },
  InhibitoryControl:   { labelKey: 'pillar.inhibitoryControl',   color: 'hsl(280, 60%, 60%)', angle: 54 },
  SustainedAttention:  { labelKey: 'pillar.sustainedAttention',  color: 'hsl(45, 80%, 60%)',  angle: 126 },
  ProcessingSpeed:     { labelKey: 'pillar.processingSpeed',     color: 'hsl(340, 70%, 60%)', angle: 198 },
};

/** All cognitive pillars in canonical order */
export const ALL_PILLARS: readonly CognitivePillar[] = [
  'WorkingMemory',
  'CognitiveFlexibility',
  'InhibitoryControl',
  'SustainedAttention',
  'ProcessingSpeed',
] as const;

/** Exercise registry */
export const EXERCISES: ExerciseInfo[] = [
  {
    type: 'ReactionTime',
    primaryPillar: 'ProcessingSpeed',
    secondaryPillars: [],
    nameKey: 'exercise.reaction.name',
    descriptionKey: 'exercise.reaction.description',
    iconGlyph: '⚡',
    trialsPerSession: 20,
    available: true,
  },
  {
    type: 'StroopTask',
    primaryPillar: 'InhibitoryControl',
    secondaryPillars: ['ProcessingSpeed'],
    nameKey: 'exercise.stroop.name',
    descriptionKey: 'exercise.stroop.description',
    iconGlyph: '🎨',
    trialsPerSession: 30,
    available: false,
  },
  {
    type: 'NBackDual',
    primaryPillar: 'WorkingMemory',
    secondaryPillars: ['SustainedAttention'],
    nameKey: 'exercise.nback.name',
    descriptionKey: 'exercise.nback.description',
    iconGlyph: '🧠',
    trialsPerSession: 25,
    available: false,
  },
  {
    type: 'SetSwitching',
    primaryPillar: 'CognitiveFlexibility',
    secondaryPillars: ['InhibitoryControl', 'ProcessingSpeed'],
    nameKey: 'exercise.setSwitch.name',
    descriptionKey: 'exercise.setSwitch.description',
    iconGlyph: '🔀',
    trialsPerSession: 30,
    available: false,
  },
  {
    type: 'PatternBreaker',
    primaryPillar: 'SustainedAttention',
    secondaryPillars: ['ProcessingSpeed'],
    nameKey: 'exercise.patternBreaker.name',
    descriptionKey: 'exercise.patternBreaker.description',
    iconGlyph: '🔍',
    trialsPerSession: 15,
    available: false,
  },
  {
    type: 'HighNumber',
    primaryPillar: 'InhibitoryControl',
    secondaryPillars: ['ProcessingSpeed'],
    nameKey: 'exercise.highNumber.name',
    descriptionKey: 'exercise.highNumber.description',
    iconGlyph: '🔢',
    trialsPerSession: 20,
    available: true,
  },
  {
    type: 'SerialSubtraction',
    primaryPillar: 'WorkingMemory',
    secondaryPillars: ['CognitiveFlexibility'],
    nameKey: 'exercise.serialSub.name',
    descriptionKey: 'exercise.serialSub.description',
    iconGlyph: '🧮',
    trialsPerSession: 15,
    available: true,
  },
];

/** Difficulty scaling parameters */
export const DIFFICULTY = {
  /** Fakeout probability at difficulty levels 5-7 */
  FAKEOUT_CHANCE_BASE: 0.15,
  /** Fakeout probability at difficulty levels 8-10 */
  FAKEOUT_CHANCE_HARD: 0.30,
  /** Base movement speed (px/frame) for moving targets at level 8+ */
  MOVEMENT_SPEED_BASE: 0.5,
  /** Serial Subtraction: subtrahend changes every N correct answers */
  SERIAL_SUB_RULE_CHANGE_EVERY: 3,
  /** High Number: number of options at levels 8-10 */
  HIGH_NUMBER_OPTIONS_HARD: 4,
} as const;
