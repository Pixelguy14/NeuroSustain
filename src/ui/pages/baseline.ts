// ============================================================
// NeuroSustain — Baseline Onboarding
// Guided introduction to establish initial cognitive ratings.
// ============================================================

import { t } from '@shared/i18n.ts';
import { router } from '../router.ts';
import { start_exercise_session } from './session.ts';

type BaselineStep = {
  exerciseType: string;
  titleKey: string;
  descKey: string;
  icon: string;
};

const BASELINE_STEPS: BaselineStep[] = [
  {
    exerciseType: 'ReactionTime',
    titleKey: 'exercise.reaction.name',
    descKey: 'exercise.reaction.description',
    icon: 'bolt'
  },
  {
    exerciseType: 'StroopTask',
    titleKey: 'exercise.stroop.name',
    descKey: 'exercise.stroop.description',
    icon: 'psychology'
  },
  {
    exerciseType: 'NBackDual',
    titleKey: 'exercise.nback.name',
    descKey: 'exercise.nback.description',
    icon: 'memory'
  }
];

export function render_baseline(stepIndex: number = 0): HTMLElement {
  const step = BASELINE_STEPS[stepIndex];
  if (!step) {
    // Finished all steps
    router.navigate('/dashboard');
    return document.createElement('div');
  }

  const page = document.createElement('div');
  page.className = 'page-content baseline-page fade-in';

  page.innerHTML = `
    <div class="baseline-container">
      <div class="baseline-progress">
        ${BASELINE_STEPS.map((_, i) => `
          <div class="baseline-progress__dot ${i <= stepIndex ? 'active' : ''}"></div>
        `).join('')}
      </div>

      <header class="baseline-header">
        <h1 class="baseline-title">${t('baseline.stepTitle', { step: stepIndex + 1 })}</h1>
        <p class="baseline-subtitle">${t('baseline.stepDesc')}</p>
      </header>

      <div class="glass-panel baseline-card">
        <span class="material-symbols-rounded baseline-card__icon">${step.icon}</span>
        <h2 class="baseline-card__title">${t(step.titleKey)}</h2>
        <p class="baseline-card__desc">${t(step.descKey)}</p>
        
        <div class="baseline-card__notice">
          This first session will be set to a moderate difficulty (Level 3).
        </div>

        <button class="btn btn--primary btn--large" id="btn-begin-baseline">
          ${t('train.start')}
        </button>
      </div>

      <button class="btn btn--ghost btn--small" style="margin-top: var(--space-xl);" id="btn-skip-baseline">
        Skip for now
      </button>
    </div>
  `;

  page.querySelector('#btn-begin-baseline')?.addEventListener('click', () => {
    // Start session at baseline difficulty (3) in 'baseline' mode
    start_exercise_session(step.exerciseType, 3, 'baseline');
  });

  page.querySelector('#btn-skip-baseline')?.addEventListener('click', () => {
    router.navigate('/dashboard');
  });

  return page;
}

/** 
 * Logic to check if we should return to baseline after a session completes.
 * Call this from results screen 'Next' button if in baseline mode.
 */
export function get_next_baseline_step(completedType: string): number | null {
  const currentIdx = BASELINE_STEPS.findIndex(s => s.exerciseType === completedType);
  if (currentIdx !== -1 && currentIdx < BASELINE_STEPS.length - 1) {
    return currentIdx + 1;
  }
  return null;
}
