// ============================================================
// NeuroSustain — Dashboard Page
// Cognitive overview with radar chart, stats, and quick actions
// ============================================================

import { t, on_locale_change } from '@shared/i18n.ts';
import { get_profile, get_ratings, get_recent_sessions } from '@shared/db.ts';
import { render_radar_chart } from '../components/radar-chart.ts';
import { GLICKO2_DEFAULTS } from '@shared/constants.ts';
import { router } from '../router.ts';
import type { CognitivePillar, PillarRating } from '@shared/types.ts';

/** Normalize Glicko-2 rating to 0-1 for radar chart */
function normalize_rating(rating: number): number {
  // Rating range: ~800 (weak) to ~2200 (strong), center at 1500
  const min = 800;
  const max = 2200;
  return Math.max(0, Math.min(1, (rating - min) / (max - min)));
}

export function render_dashboard(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page-content';
  page.id = 'page-dashboard';

  // Build initial skeleton
  page.innerHTML = `
    <div class="section-header">
      <h1 class="section-header__title">${t('dashboard.title')}</h1>
      <p class="section-header__subtitle" id="dashboard-subtitle"></p>
    </div>

    <div class="stats-grid" id="dashboard-stats" style="margin-bottom: var(--space-xl);">
      <div class="glass-panel stat-card" id="stat-streak">
        <div class="stat-card__label">${t('dashboard.streak')}</div>
        <div class="stat-card__value stat-card__accent" id="stat-streak-value">—</div>
      </div>
      <div class="glass-panel stat-card" id="stat-sessions">
        <div class="stat-card__label">${t('dashboard.totalSessions')}</div>
        <div class="stat-card__value" id="stat-sessions-value">—</div>
      </div>
      <div class="glass-panel stat-card" id="stat-last">
        <div class="stat-card__label">${t('dashboard.lastSession')}</div>
        <div class="stat-card__value" id="stat-last-value">—</div>
      </div>
    </div>

    <div class="glass-panel radar-container" style="margin-bottom: var(--space-xl);">
      <h2 class="radar-container__title">${t('dashboard.radarTitle')}</h2>
      <canvas id="radar-canvas"></canvas>
      <p id="radar-empty" style="display:none; color: var(--color-text-tertiary); font-size: var(--font-size-sm); margin-top: var(--space-md);">
        ${t('dashboard.radarEmpty')}
      </p>
    </div>

    <div style="display: flex; justify-content: center;">
      <button class="btn btn--primary btn--large" id="btn-start-training">
        ${t('dashboard.startTraining')}
      </button>
    </div>
  `;

  // Wire up training button
  const startBtn = page.querySelector('#btn-start-training');
  startBtn?.addEventListener('click', () => router.navigate('/train'));

  // Load data asynchronously
  _populate_dashboard(page);

  // Re-render on locale change
  const unsub = on_locale_change(() => {
    const container = page.parentElement;
    if (container) {
      container.innerHTML = '';
      container.appendChild(render_dashboard());
    }
  });

  // Clean up on removal (MutationObserver alternative)
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.removedNodes) {
        if (node === page) {
          unsub();
          observer.disconnect();
          return;
        }
      }
    }
  });
  if (page.parentElement) {
    observer.observe(page.parentElement, { childList: true });
  }

  return page;
}

async function _populate_dashboard(page: HTMLElement): Promise<void> {
  const [profile, ratings, recentSessions] = await Promise.all([
    get_profile(),
    get_ratings(),
    get_recent_sessions(1),
  ]);

  // Subtitle
  const subtitle = page.querySelector('#dashboard-subtitle');
  if (subtitle) {
    subtitle.textContent = profile && profile.totalSessions > 0
      ? t('dashboard.welcome')
      : t('dashboard.firstTimeDesc');
  }

  // Stats
  const streakEl = page.querySelector('#stat-streak-value');
  if (streakEl) {
    streakEl.textContent = profile ? t('dashboard.streakDays', { days: profile.currentStreak }) : '0';
  }

  const sessionsEl = page.querySelector('#stat-sessions-value');
  if (sessionsEl) {
    sessionsEl.textContent = String(profile?.totalSessions ?? 0);
  }

  const lastEl = page.querySelector('#stat-last-value');
  if (lastEl) {
    const lastSession = recentSessions[0];
    if (lastSession) {
      const date = new Date(lastSession.startedAt);
      lastEl.textContent = date.toLocaleDateString();
    } else {
      lastEl.textContent = t('dashboard.noSessions');
    }
  }

  // Radar chart
  const canvas = page.querySelector('#radar-canvas') as HTMLCanvasElement | null;
  const emptyMsg = page.querySelector('#radar-empty') as HTMLElement | null;

  if (canvas) {
    const hasData = ratings.some((r: PillarRating) => r.rating !== GLICKO2_DEFAULTS.INITIAL_RATING);

    if (hasData) {
      const values: Record<CognitivePillar, number> = {} as Record<CognitivePillar, number>;
      for (const r of ratings) {
        values[r.pillar] = normalize_rating(r.rating);
      }
      render_radar_chart(canvas, { values });
      if (emptyMsg) emptyMsg.style.display = 'none';
    } else {
      // Show empty radar with default values
      render_radar_chart(canvas, {
        values: {
          WorkingMemory: 0.1,
          CognitiveFlexibility: 0.1,
          InhibitoryControl: 0.1,
          SustainedAttention: 0.1,
          ProcessingSpeed: 0.1,
        },
      });
      if (emptyMsg) emptyMsg.style.display = 'block';
    }
  }
}
