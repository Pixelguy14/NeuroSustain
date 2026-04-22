// ============================================================
// NeuroSustain — Training Page (Bento Box Edition)
// Exercise selection grid with pillar-based grouping
// ============================================================

import { t } from '@shared/i18n.ts';
import { EXERCISES, ALL_PILLARS } from '@shared/constants.ts';
import { start_exercise_session, start_neural_storm } from '../pages/session.ts';
import { get_ratings } from '@shared/db.ts';
import { fsrsBridge } from '@core/fsrs/fsrs-bridge.ts';
import '../components/pillar-card.ts'; // Register Web Component
import type { PillarCard } from '../components/pillar-card.ts';

export function render_train(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page-content';
  page.id = 'page-train';

  page.innerHTML = `
    <div class="section-header">
      <h1 class="section-header__title">${t('train.title')}</h1>
      <p class="section-header__subtitle">${t('train.selectExercise')}</p>
    </div>
    
    <div class="bento-grid" id="bento-grid">
      <!-- Pillar cards injected here -->
    </div>

    <div class="neural-storm-card glass-panel" id="neural-storm-btn">
      <div class="neural-storm-card__content">
        <h2 class="neural-storm-card__title">${t('train.storm.title')}</h2>
        <p class="neural-storm-card__desc">${t('train.storm.desc')}</p>
      </div>
      <div class="neural-storm-card__action">${t('train.storm.start')}</div>
    </div>
  `;

  const grid = page.querySelector('#bento-grid') as HTMLElement;

  // Load ratings and populate grid
  let currentRatings: any[] = [];
  Promise.all([get_ratings(), fsrsBridge.get_due_exercises()]).then(([ratings, dueCards]) => {
    currentRatings = ratings;
    grid.innerHTML = ''; // Clear skeleton

    const dueTypes = dueCards.map(c => c.exerciseType);

    ALL_PILLARS.forEach(pillar => {
      const pillarRating = ratings.find(r => r.pillar === pillar);
      const pillarExercises = EXERCISES.filter(ex => ex.primaryPillar === pillar);
      
      const card = document.createElement('pillar-card') as PillarCard;
      card.data = {
        pillar,
        exercises: pillarExercises,
        rating: pillarRating?.rating,
        rd: pillarRating?.rd,
        isFatigued: false,
        dueExercises: dueTypes
      };

      grid.appendChild(card);
    });
  });

  // Listen for exercise selection from children
  page.addEventListener('select-exercise', (e: any) => {
    const exerciseType = e.detail.type;
    const ex = EXERCISES.find(e => e.type === exerciseType);
    const rating = currentRatings.find(r => r.pillar === ex?.primaryPillar)?.rating ?? 1500;
    const difficulty = Math.min(10, Math.max(1, Math.floor((rating - 1300) / 100) + 1));
    start_exercise_session(exerciseType, difficulty);
  });

  // Neural Storm handler
  page.querySelector('#neural-storm-btn')?.addEventListener('click', () => {
    start_neural_storm();
  });

  return page;
}
