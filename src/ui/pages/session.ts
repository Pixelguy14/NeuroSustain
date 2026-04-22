// ============================================================
// NeuroSustain — Session Page
// Full-viewport exercise container with results screen
// ============================================================

import type { TrialResults, Trial, Session } from '@shared/types.ts';
import { ReactionTimeEngine } from '@engines/reaction/reaction-engine.ts';
import { generate_uuid, format_ms } from '@shared/utils.ts';
import { save_session } from '@shared/db.ts';
import { t } from '@shared/i18n.ts';
import { router } from '../router.ts';
import { TIMING } from '@shared/constants.ts';
import { detect_fatigue } from '@core/analytics/analytics.ts';
import { show_loading, hide_loading } from '../components/loading-screen.ts';
import type { BaseEngine } from '@engines/base-engine.ts';

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
      // Could add real-time HUD updates here
    },
    onSessionComplete: (results: TrialResults) => {
      // Clean up engine
      _activeEngine?.stop();
      _activeEngine = null;
      container.remove();

      // Save to IndexedDB
      _save_and_show_results(sessionId, results);
    },
    onExit: () => {
      _activeEngine?.stop();
      _activeEngine = null;
      container.remove();
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

  await save_session(session, trials);

  // Show results screen
  _render_results_screen(results);
}

function _render_results_screen(results: TrialResults): void {
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
