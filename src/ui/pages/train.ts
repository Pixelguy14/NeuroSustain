// ============================================================
// NeuroSustain — Training Page
// Exercise selection grid with availability status
// ============================================================

import { t } from '@shared/i18n.ts';
import { EXERCISES } from '@shared/constants.ts';
import { start_exercise_session } from '../pages/session.ts';

export function render_train(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page-content';
  page.id = 'page-train';

  page.innerHTML = `
    <div class="section-header">
      <h1 class="section-header__title">${t('train.title')}</h1>
      <p class="section-header__subtitle">${t('train.selectExercise')}</p>
    </div>
    <div class="exercises-grid" id="exercises-grid">
      ${EXERCISES.map(ex => `
        <div class="glass-panel glass-panel--glow exercise-card ${!ex.available ? 'exercise-card--locked' : ''}"
             data-exercise="${ex.type}"
             id="exercise-card-${ex.type}">
          <div class="exercise-card__icon">${ex.iconGlyph}</div>
          <div class="exercise-card__name">${t(ex.nameKey)}</div>
          <div class="exercise-card__desc">${t(ex.descriptionKey)}</div>
          <div class="exercise-card__badge">
            ${ex.available
              ? t('train.trials', { count: ex.trialsPerSession })
              : t('train.locked')
            }
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Wire up available exercise cards
  const cards = page.querySelectorAll('.exercise-card:not(.exercise-card--locked)');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const exerciseType = (card as HTMLElement).dataset['exercise'];
      if (exerciseType) {
        start_exercise_session(exerciseType);
      }
    });
  });

  return page;
}
