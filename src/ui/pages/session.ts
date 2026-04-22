// ============================================================
// NeuroSustain — Session Page
// Full-viewport exercise container with results screen
// ============================================================

import type { TrialResults, Trial, Session, FatigueEvent } from '@shared/types.ts';
import { ReactionTimeEngine } from '@engines/reaction/reaction-engine.ts';
import { generate_uuid, format_ms } from '@shared/utils.ts';
import { save_session } from '@shared/db.ts';
import { t } from '@shared/i18n.ts';
import { router } from '../router.ts';
import { TIMING } from '@shared/constants.ts';
import { detect_fatigue } from '@core/analytics/analytics.ts';
import { show_loading, hide_loading } from '../components/loading-screen.ts';
import type { BaseEngine } from '@engines/base-engine.ts';
import { fsrsBridge } from '@core/fsrs/fsrs-bridge.ts';

let _activeEngine: BaseEngine | null = null;

/** Start an exercise session */
export function start_exercise_session(exerciseType: string): void {
  show_loading('loading.calibrating');

  setTimeout(() => {
    hide_loading();
    _launch_engine(exerciseType);
  }, 1200);
}

function _launch_engine(exerciseType: string): void {
  // Create full-viewport container
  const container = document.createElement('div');
  container.className = 'session-canvas';
  container.id = 'session-container';

  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  document.body.appendChild(container);

  const sessionId = generate_uuid();

  const callbacks = {
    onTrialComplete: (_trial: Omit<Trial, 'id' | 'sessionId'>) => {
      // Real-time HUD updates can hook here
    },
    onSessionComplete: (results: TrialResults) => {
      _activeEngine?.stop();
      _activeEngine = null;
      container.remove();
      _save_and_show_results(sessionId, results);
    },
    onExit: () => {
      _activeEngine?.stop();
      _activeEngine = null;
      container.remove();
    },
    // System B: Show a subtle fatigue warning overlay inside the session
    onFatigueDetected: (event: FatigueEvent) => {
      _show_fatigue_warning(container, event);
    },
  };

  // Create engine based on type
  switch (exerciseType) {
    case 'ReactionTime':
      _activeEngine = new ReactionTimeEngine(canvas, callbacks);
      break;
    default:
      console.warn(`Exercise type "${exerciseType}" not implemented`);
      container.remove();
      return;
  }

  _activeEngine.start();
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
    difficultyStart: 1,
    difficultyEnd: 1,
    focusScore: results.focusScore,
  };

  // Build trial records with sessionId
  const trials: Trial[] = results.trials.map(tr => ({
    ...tr,
    sessionId,
  }));

  // Run DB save and FSRS recalibration in parallel — both are non-blocking
  const results_ = await Promise.allSettled([
    save_session(session, trials),
    fsrsBridge.recalibrate_after_session(
      results.exerciseType,
      results.pillar,
      results.accuracy,
      results.focusScore,
      results.cvReactionTime,
      trials
    ),
  ]);

  // Extract FSRS scheduling info if the worker succeeded
  const fsrsResult = results_[1];
  const fsrsData = fsrsResult?.status === 'fulfilled' ? fsrsResult.value : null;

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

    <p class="results-screen__insight" style="border-left-color: ${cvColor}">
      ${cvLabel}${isFatigued ? ' 💤' : ''}
    </p>

    ${fsrs ? `
    <div class="glass-panel" style="padding: var(--space-md) var(--space-lg); margin-bottom: var(--space-lg); display: flex; gap: var(--space-xl); align-items: center; justify-content: center;">
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

    <div class="results-screen__actions">
      <button class="btn btn--ghost btn--large" id="btn-back-dashboard">${t('results.backToDashboard')}</button>
      <button class="btn btn--primary btn--large" id="btn-train-again">${t('results.trainAgain')}</button>
    </div>
  `;

  document.body.appendChild(screen);

  screen.querySelector('#btn-back-dashboard')?.addEventListener('click', () => {
    screen.remove();
    router.navigate('/dashboard');
  });

  screen.querySelector('#btn-train-again')?.addEventListener('click', () => {
    screen.remove();
    start_exercise_session(results.exerciseType);
  });
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
    <div style="font-weight: 600; color: hsl(38, 90%, 60%); margin-bottom: 4px;">
      💤 ${t('fatigue.toast.title')}
    </div>
    <div style="color: hsl(220, 15%, 60%); line-height: 1.5;">
      ${t('fatigue.toast.desc', { 
        rise: event.risePercent, 
        base: event.baselineEmaMs, 
        curr: event.currentEmaMs 
      })}
    </div>
  `;

  container.style.position = 'relative';
  container.appendChild(toast);

  // Auto-dismiss after 4s
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease-out';
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}
