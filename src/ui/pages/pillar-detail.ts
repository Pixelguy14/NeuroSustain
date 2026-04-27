// ============================================================
// NeuroSustain — Pillar Detail Page
// Deep-dive into a specific cognitive pillar with scientific
// context and longitudinal performance tracking.
// ============================================================

import type { CognitivePillar } from '@shared/types.ts';
import { PILLAR_META, EXERCISES } from '@shared/constants.ts';
import { db, get_pillar_sessions } from '@shared/db.ts';
import { t } from '@shared/i18n.ts';
import { router } from '../router.ts';
import { render_sparkline } from '../components/sparkline.ts';

export async function render_pillar_detail(pillar: CognitivePillar): Promise<HTMLElement> {
  const meta = PILLAR_META[pillar];
  const page = document.createElement('div');
  page.className = 'pillar-detail-page fade-in';
  
  // Get pillar data
  const rating = await db.ratings.get(pillar);
  const sessions = await get_pillar_sessions(pillar);
  const relatedExercises = EXERCISES.filter(ex => ex.primaryPillar === pillar);

  page.innerHTML = `
    <header class="pillar-detail-header">
      <button class="btn btn--ghost btn--small" id="btn-back-dashboard">
        ${t('pillarDetail.back')}
      </button>
      <div class="pillar-detail-header__title-row">
        <span class="material-symbols-rounded" style="color: ${meta.color}; font-size: 32px;">${meta.icon}</span>
        <h1>${t(meta.labelKey)}</h1>
      </div>
    </header>

    <div class="pillar-detail-grid">
      <!-- About Section -->
      <section class="glass-panel pillar-info-card">
        <h2 class="section-title">${t('pillarDetail.about')}</h2>
        <p class="pillar-description">${t(`pillar.${pillar}.desc`)}</p>
        
        <div class="pillar-rating-box">
          <div class="pillar-rating-box__label">${t('pillarDetail.rating')}</div>
          <div class="pillar-rating-box__value" style="color: ${meta.color}">
            ${Math.round(rating?.rating ?? 1500)}
          </div>
          <div class="pillar-rating-box__rd">±${Math.round(rating?.rd ?? 350)} RD</div>
        </div>
      </section>

      <!-- History Section -->
      <section class="glass-panel pillar-history-card">
        <h2 class="section-title">${t('pillarDetail.history')}</h2>
        <div class="pillar-sparkline-container">
          <canvas id="pillar-trend-canvas"></canvas>
        </div>
        <div class="pillar-stats-summary">
          <div class="mini-stat">
            <span class="mini-stat__label">Sessions</span>
            <span class="mini-stat__value">${sessions.length}</span>
          </div>
          <div class="mini-stat">
            <span class="mini-stat__label">Avg. Accuracy</span>
            <span class="mini-stat__value">
              ${sessions.length > 0 
                ? Math.round((sessions.reduce((a, b) => a + b.accuracy, 0) / sessions.length) * 100) 
                : 0}%
            </span>
          </div>
        </div>
      </section>

      <!-- Related Exercises -->
      <section class="pillar-exercises-section">
        <h2 class="section-title">${t('pillarDetail.exercises')}</h2>
        <div class="related-exercises-list">
          ${relatedExercises.map(ex => `
            <div class="glass-panel exercise-pill" id="ex-${ex.type}">
              <span class="material-symbols-rounded">${ex.iconGlyph}</span>
              <div class="exercise-pill__info">
                <div class="exercise-pill__name">${t(ex.nameKey)}</div>
                <div class="exercise-pill__desc">${t(ex.descriptionKey)}</div>
              </div>
              <button class="btn btn--primary btn--small btn-start-ex" data-type="${ex.type}">
                ${t('train.start')}
              </button>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  // Event Listeners
  page.querySelector('#btn-back-dashboard')?.addEventListener('click', () => {
    router.navigate('/dashboard');
  });

  page.querySelectorAll('.btn-start-ex').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = (e.currentTarget as HTMLElement).dataset.type;
      if (type) {
        import('./session.ts').then(m => m.start_exercise_session(type));
      }
    });
  });

  // Render Trend
  setTimeout(() => {
    const canvas = page.querySelector('#pillar-trend-canvas') as HTMLCanvasElement;
    if (canvas && sessions.length > 0) {
      const data = sessions.slice(-15).map(s => s.accuracy * 100);
      render_sparkline(canvas, data, {
        color: meta.color,
        height: 120,
        isInverse: false
      });
    }
  }, 0);

  return page;
}
