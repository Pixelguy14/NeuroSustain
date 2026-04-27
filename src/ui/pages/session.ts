// ============================================================
// NeuroSustain — Session Page
// Full-viewport exercise container with results screen
// ============================================================

import type { TrialResults, Trial, Session, FatigueEvent } from '@shared/types.ts';
import { ReactionTimeEngine } from '@engines/reaction/reaction-engine.ts';
import { HighNumberEngine } from '@engines/high-number/high-number-engine.ts';
import { SerialSubtractionEngine } from '@engines/serial-sub/serial-sub-engine.ts';
import { PianoPlayerEngine } from '@engines/piano-player/piano-player-engine.ts';
import { FallacyDetectorEngine } from '@engines/fallacy-detector/fallacy-detector-engine.ts';
import { HanoiEngine } from '@engines/hanoi/hanoi-engine.ts';
import { SetSwitchingEngine } from '@engines/set-switching/set-switching-engine.ts';
import { FreeDrawEngine } from '@engines/free-draw/free-draw-engine.ts';
import { NBackEngine } from '@engines/nback/nback-engine.ts';
import { ChangeMakerEngine } from '@engines/change-maker/change-maker-engine.ts';
import { WordScrambleEngine } from '@engines/word-scramble/word-scramble-engine.ts';
import { StroopEngine } from '@engines/stroop/stroop-engine.ts';
import { SymbolSearchEngine } from '@engines/symbol-search/symbol-search-engine.ts';
import { InspectionTimeEngine } from '@engines/inspection-time/inspection-time-engine.ts';
import { generate_uuid, format_ms } from '@shared/utils.ts';
import { save_session, update_pillar_skill } from '@shared/db.ts';
import { t } from '@shared/i18n.ts';
import { router } from '../router.ts';
import { TIMING } from '@shared/constants.ts';
import { detect_fatigue } from '@core/analytics/analytics.ts';
import { show_loading } from '../components/loading-screen.ts';
import { render_sparkline } from '../components/sparkline.ts';
import type { BaseEngine } from '@engines/base-engine.ts';
import { fsrsBridge } from '@core/fsrs/fsrs-bridge.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

let _activeEngine: BaseEngine | null = null;
let _neuralStormTimeout: number | null = null;
let _sessionMode: 'normal' | 'baseline' = 'normal';

/** Start an exercise session */
export function start_exercise_session(exerciseType: string, difficulty: number = 1, mode: 'normal' | 'baseline' = 'normal'): void {
  _sessionMode = mode;
  // If debug override exists, use it
  const debugDiff = localStorage.getItem('DEBUG_DIFFICULTY');
  if (debugDiff) difficulty = parseInt(debugDiff, 10);

  show_loading('loading.calibrating', true).then(() => {
    _launch_engine(exerciseType, false, difficulty);
  });
}

/** Start a Neural Storm session (mixed mode) */
export function start_neural_storm(): void {
  _sessionMode = 'normal';
  show_loading('loading.neural_storm', true).then(() => {
    _launch_neural_storm();
  });
}

async function _launch_engine(exerciseType: string, isNeuralStorm: boolean = false, overrideDifficulty: number = 1): Promise<void> {
  // Create full-viewport container (only if it doesn't exist)
  let container = document.getElementById('session-container');
  let canvas: HTMLCanvasElement;

  if (!container) {
    container = document.createElement('div');
    container.className = 'session-canvas';
    container.id = 'session-container';
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);
  } else {
    canvas = container.querySelector('canvas')!;
  }

  const sessionId = generate_uuid();

  const callbacks = {
    onTrialComplete: (_trial: Omit<Trial, 'id' | 'sessionId'>) => {},
    onSessionComplete: (results: TrialResults) => {
      _activeEngine?.stop();
      _activeEngine = null;
      if (!isNeuralStorm) {
        container?.remove();
        _save_and_show_results(sessionId, results);
      }
    },
    onExit: () => {
      _activeEngine?.stop();
      _activeEngine = null;
      if (_neuralStormTimeout !== null) {
        window.clearTimeout(_neuralStormTimeout);
        _neuralStormTimeout = null;
      }
      container?.remove();
      router.navigate(_sessionMode === 'baseline' ? '/baseline' : '/train');
    },
    onFatigueDetected: (event: FatigueEvent) => {
      if (!isNeuralStorm) _show_fatigue_warning(container!, event);
    },
  };

  audioEngine.unlock();

  // Stop and cleanup existing engine if one is active
  if (_activeEngine) {
    _activeEngine.stop();
    _activeEngine = null;
  }

  switch (exerciseType) {
    case 'ReactionTime':
      _activeEngine = new ReactionTimeEngine(canvas, callbacks);
      break;
    case 'HighNumber':
      _activeEngine = new HighNumberEngine(canvas, callbacks);
      break;
    case 'SerialSubtraction':
      _activeEngine = new SerialSubtractionEngine(canvas, callbacks);
      break;
    case 'PianoPlayer':
      _activeEngine = new PianoPlayerEngine(canvas, callbacks);
      break;
    case 'FallacyDetector':
      _activeEngine = new FallacyDetectorEngine(canvas, callbacks);
      break;
    case 'TowerOfHanoi':
      _activeEngine = new HanoiEngine(canvas, callbacks);
      break;
    case 'SetSwitching':
      _activeEngine = new SetSwitchingEngine(canvas, callbacks);
      break;
    case 'FreeDraw':
      _activeEngine = new FreeDrawEngine(canvas, callbacks);
      break;
    case 'NBackDual':
      _activeEngine = new NBackEngine(canvas, callbacks);
      break;
    case 'ChangeMaker':
      _activeEngine = new ChangeMakerEngine(canvas, callbacks);
      break;
    case 'WordScramble':
      _activeEngine = new WordScrambleEngine(canvas, callbacks);
      break;
    case 'BlockCount3D': {
      const { BoxCountEngine } = await import('@engines/box-count/box-count-engine.ts');
      
      // RACECONDITION FIX: Check if container is still in DOM or if user navigated away
      if (!document.getElementById('session-container') || document.getElementById('session-container') !== container) {
        return;
      }
      
      _activeEngine = new BoxCountEngine(canvas, callbacks);
      break;
    }
    case 'StroopTask':
      _activeEngine = new StroopEngine(canvas, callbacks);
      break;
    case 'SymbolSearch':
      _activeEngine = new SymbolSearchEngine(canvas, callbacks);
      break;
    case 'InspectionTime':
      _activeEngine = new InspectionTimeEngine(canvas, callbacks);
      break;
    case 'PatternBreaker': {
      const { PatternBreakerEngine } = await import('@engines/pattern-breaker/pattern-breaker-engine.ts');
      if (!document.getElementById('session-container') || document.getElementById('session-container') !== container) {
        return;
      }
      _activeEngine = new PatternBreakerEngine(canvas, callbacks);
      break;
    }
    default:
      console.warn(`Exercise type "${exerciseType}" not implemented`);
      container.remove();
      return;
  }

  if (!_activeEngine) return;
  _activeEngine.start({ 
    difficulty: overrideDifficulty, 
    inputMode: 'auto',
    neuralStorm: isNeuralStorm
  });
}

function _launch_neural_storm(): void {
  const STORM_DURATION_MS = 180_000; // 3 minutes
  const SWITCH_INTERVAL_MS = 30_000; // 30 seconds
  const GRACE_PERIOD_MS = 2000; // 2 seconds of transition
  const pool = ['ReactionTime', 'HighNumber', 'SerialSubtraction', 'PianoPlayer', 'FallacyDetector', 'TowerOfHanoi', 'SetSwitching', 'NBackDual', 'ChangeMaker', 'WordScramble', 'BlockCount3D', 'StroopTask', 'SymbolSearch', 'InspectionTime'];
  
  let elapsed = 0;
  let lastType = '';
  
  const switch_exercise = () => {
    if (elapsed >= STORM_DURATION_MS) {
      const container = document.getElementById('session-container');
      _activeEngine?.stop();
      _activeEngine = null;
      container?.remove();
      router.navigate('/train');
      return;
    }

    audioEngine.play_transition();
    
    // Create container if it doesn't exist
    let container = document.getElementById('session-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'session-canvas';
      container.id = 'session-container';
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      document.body.appendChild(container);
    }

    // Show Grace Period UI
    if (container) {
      const overlay = document.createElement('div');
      overlay.className = 'grace-period-overlay';
      overlay.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-primary);
        z-index: 100;
        font-family: var(--font-family);
        color: var(--color-text-primary);
        font-size: var(--font-size-2xl);
        font-weight: 700;
        letter-spacing: 0.1em;
      `;
      overlay.textContent = 'RECALIBRATING';
      container.appendChild(overlay);

      setTimeout(() => {
        overlay.remove();
        
        // Prevent same minigame in sequence
        const availablePool = pool.filter(t => t !== lastType);
        const type = availablePool[Math.floor(Math.random() * availablePool.length)]!;
        lastType = type;
        
        // Wacky dynamic difficulty for Neural Storm (levels 3 to 10)
        const stormDiff = 3 + Math.floor(Math.random() * 8);
        _launch_engine(type, true, stormDiff);
        
        // Timer only advances after grace period
        elapsed += SWITCH_INTERVAL_MS;
        _neuralStormTimeout = window.setTimeout(switch_exercise, SWITCH_INTERVAL_MS);
      }, GRACE_PERIOD_MS);
    }
  };

  switch_exercise();
}

async function _save_and_show_results(sessionId: string, results: TrialResults): Promise<void> {
  // Build session record
  const session: Session = {
    sessionId,
    startedAt: results.trials[0]?.timestamp ?? Date.now(),
    endedAt: Date.now(),
    pillar: results.pillar,
    exerciseType: results.exerciseType,
    trialCount: results.trials.length,
    accuracy: results.accuracy,
    meanReactionTimeMs: results.meanReactionTimeMs,
    cvReactionTime: results.cvReactionTime,
    difficultyStart: results.trials[0]?.difficulty ?? results.meanDifficulty,
    difficultyEnd: results.trials[results.trials.length - 1]?.difficulty ?? results.meanDifficulty,
    meanDifficulty: results.meanDifficulty,
    focusScore: results.focusScore,
  };

  // Build trial records with sessionId
  const trials: Trial[] = results.trials.map(tr => ({
    ...tr,
    sessionId,
  }));

  // Data Insulation for Neural Storm
  const isStorm = results.trials[0]?.isNeuralStorm === true;
  let fsrsData = null;

  if (!isStorm) {
    // Run DB save and FSRS recalibration in parallel — both are non-blocking
    const results_ = await Promise.allSettled([
      save_session(session, trials),
      update_pillar_skill(
        results.pillar,
        results.meanDifficulty,
        results.accuracy,
        results.focusScore
      ),
      fsrsBridge.recalibrate_after_session(
        results.exerciseType,
        results.pillar,
        results.accuracy,
        results.focusScore,
        results.cvReactionTime,
        results.meanDifficulty,
        trials
      ),
    ]);

    // Extract FSRS scheduling info if the worker succeeded
    const fsrsResult = results_[2];
    fsrsData = fsrsResult?.status === 'fulfilled' ? fsrsResult.value : null;
  }

  // Show results screen with optional FSRS metadata
  _render_results_screen(results, fsrsData);
}

interface FsrsDisplayData {
  scheduledDays: number;
  derivedRating: number;
  retrievability: number;
}

function _render_results_screen(results: TrialResults, fsrs: FsrsDisplayData | null): void {
  const screen = document.createElement('div');
  screen.className = 'results-screen';
  screen.id = 'results-screen';

  // Determine CV quality
  let cvLabel: string;
  let cvColor: string;
  if (results.cvReactionTime < 0.15) {
    cvLabel = t('results.cvExcellent');
    cvColor = 'var(--color-success)';
  } else if (results.cvReactionTime < TIMING.FATIGUE_CV_THRESHOLD) {
    cvLabel = t('results.cvGood');
    cvColor = 'var(--color-accent-primary)';
  } else {
    cvLabel = t('results.cvFatigue');
    cvColor = 'var(--color-warning)';
  }

  const isFatigued = detect_fatigue(results.cvReactionTime);

  screen.innerHTML = `
    <div class="results-screen__scroll-container" style="width: 100%; height: 100%; overflow-y: auto; display: flex; flex-direction: column; align-items: center; padding: var(--space-2xl) var(--space-lg);">
      <h1 class="results-screen__title">${t('results.title')}</h1>
  
      <div class="results-screen__grid">
        <div class="glass-panel stat-card">
          <div class="stat-card__label">${t('results.meanRT')}</div>
          <div class="stat-card__value stat-card__accent">${format_ms(results.meanReactionTimeMs)}</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="stat-card__label">${t('results.accuracy')}</div>
          <div class="stat-card__value">${Math.round(results.accuracy * 100)}%</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="stat-card__label">${t('results.sdRT')}</div>
          <div class="stat-card__value">${format_ms(results.sdReactionTimeMs)}</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="stat-card__label">${t('results.cv')}</div>
          <div class="stat-card__value" style="color: ${cvColor}">${results.cvReactionTime.toFixed(3)}</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="stat-card__label">${t('results.focusScore')}</div>
          <div class="stat-card__value stat-card__accent">${results.focusScore.toFixed(1)}</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="stat-card__label">${t('results.trials')}</div>
          <div class="stat-card__value">${results.trials.length}</div>
        </div>
      </div>
  
      <!-- RT Trend Sparkline -->
      <div class="glass-panel" style="padding: var(--space-md); margin-bottom: var(--space-lg); width: 100%; max-width: 700px;">
        <div style="font-size: 10px; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; text-align: center;">
          Intra-Session Fatigue Trend (RT)
        </div>
        <canvas id="rt-trend-sparkline" style="width: 100%; height: 60px;"></canvas>
      </div>
  
      <p class="results-screen__insight" style="border-left-color: ${cvColor}">
        ${cvLabel}${isFatigued ? ' 💤' : ''}
      </p>
  
      ${fsrs ? `
      <div class="glass-panel" style="padding: var(--space-md) var(--space-lg); margin-bottom: var(--space-lg); display: flex; gap: var(--space-xl); align-items: center; justify-content: center; width: 100%; max-width: 700px;">
        <div style="text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">${t('results.fsrs.memory')}</div>
          <div style="font-size: var(--font-size-lg); font-weight: 600; color: hsl(${Math.round(fsrs.retrievability * 120)}, 65%, 55%)">
            ${Math.round(fsrs.retrievability * 100)}%
          </div>
        </div>
        <div style="width: 1px; height: 40px; background: var(--glass-border);"></div>
        <div style="text-align: center;">
          <div style="font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">${t('results.fsrs.nextReview')}</div>
          <div style="font-size: var(--font-size-lg); font-weight: 600; color: var(--color-accent-primary)">
            ${fsrs.scheduledDays === 1 ? t('results.fsrs.tomorrow') : t('results.fsrs.days', { days: fsrs.scheduledDays })}
          </div>
        </div>
      </div>
      ` : ''}
  
      <div class="results-screen__actions" style="padding-bottom: 40px;">
        ${_sessionMode === 'baseline' ? `
          <button class="btn btn--primary btn--large" id="btn-continue-baseline">Continue Baseline</button>
        ` : `
          <button class="btn btn--ghost btn--large" id="btn-back-dashboard">${t('results.backToDashboard')}</button>
          <button class="btn btn--primary btn--large" id="btn-train-again">${t('results.trainAgain')}</button>
        `}
      </div>
    </div>
  `;

  document.body.appendChild(screen);

  screen.querySelector('#btn-continue-baseline')?.addEventListener('click', async () => {
    screen.remove();
    const { get_next_baseline_step, render_baseline } = await import('./baseline.ts');
    const nextStep = get_next_baseline_step(results.exerciseType);
    if (nextStep !== null) {
      const container = document.getElementById('page-container');
      if (container) {
        container.innerHTML = '';
        container.appendChild(render_baseline(nextStep));
      }
    } else {
      router.navigate('/dashboard');
    }
  });

  screen.querySelector('#btn-back-dashboard')?.addEventListener('click', () => {
    screen.remove();
    router.navigate('/dashboard');
  });

  screen.querySelector('#btn-train-again')?.addEventListener('click', () => {
    screen.remove();
    start_exercise_session(results.exerciseType);
  });

  // Render Sparkline
  const sparklineCanvas = screen.querySelector('#rt-trend-sparkline') as HTMLCanvasElement;
  if (sparklineCanvas) {
    const rtData = results.trials.map(t => t.reactionTimeMs);
    render_sparkline(sparklineCanvas, rtData, {
      color: results.cvReactionTime > TIMING.FATIGUE_CV_THRESHOLD ? 'hsl(38, 90%, 55%)' : 'hsl(175, 70%, 50%)',
      isInverse: true,
      height: 60
    });
  }
}

/**
 * System B: Non-blocking fatigue warning overlay.
 * Appears inside the session container, auto-dismisses after 4 seconds.
 * Does NOT interrupt the exercise — the user can continue or acknowledge.
 */
function _show_fatigue_warning(container: HTMLElement, event: FatigueEvent): void {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: hsla(225, 35%, 12%, 0.92);
    border: 1px solid hsl(38, 90%, 55%);
    border-radius: 10px;
    padding: 12px 20px;
    font-family: Inter, sans-serif;
    font-size: 13px;
    color: hsl(220, 20%, 85%);
    backdrop-filter: blur(12px);
    z-index: 10;
    text-align: center;
    max-width: 320px;
    animation: fadeIn 0.3s ease-out;
    box-shadow: 0 4px 20px hsla(38, 90%, 30%, 0.25);
  `;
  toast.innerHTML = `
    <div class="fatigue-warning__icon">⚠️</div>
    <div class="fatigue-warning__content">
      <div class="fatigue-warning__title">${t('fatigue.toast.title')}</div>
      <div class="fatigue-warning__desc">
        ${t('fatigue.toast.desc', { 
          rise: event.risePercent, 
          base: event.baselineEmaMs, 
          curr: event.currentEmaMs 
        })}
      </div>
      <button class="btn btn--ghost btn--small fatigue-warning__action" id="fatigue-break-btn">
        Take a Break
      </button>
    </div>
  `;

  container.appendChild(toast);

  toast.querySelector('#fatigue-break-btn')?.addEventListener('click', () => {
    _activeEngine?.stop();
    toast.remove();
    _launch_engine('FreeDraw');
  });

  // Auto-dismiss after 4s
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease-out';
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}
