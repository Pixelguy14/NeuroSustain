// ============================================================
// NeuroSustain — Dashboard Page
// Cognitive overview with radar chart, stats, and quick actions
// ============================================================

import { t, on_locale_change, get_locale } from '@shared/i18n.ts';
import { get_profile, get_ratings, get_recent_sessions, get_sessions_history, get_sessions_raw } from '@shared/db.ts';
import { render_radar_chart } from '../components/radar-chart.ts';
import { render_line_chart } from '../components/line-chart.ts';
import { render_performance_heatmap } from '../components/heatmap.ts';
import { render_calendar_heatmap } from '../components/calendar-heatmap.ts';
import { GLICKO2_DEFAULTS, EXERCISES, PILLAR_META } from '@shared/constants.ts';
import { router } from '../router.ts';
import { start_exercise_session } from './session.ts';
import { fsrsBridge } from '@core/fsrs/fsrs-bridge.ts';
import { get_current_retrievability } from '@core/fsrs/fsrs-algorithm.ts';
import { syncManager } from '@core/sync/sync-manager.ts';
import { render_sparkline } from '../components/sparkline.ts';
import type { CognitivePillar, PillarRating } from '@shared/types.ts';

/** Normalize Glicko-2 rating to 0-1 for radar chart */
function normalize_rating(rating: number): number {
  // Rating range: ~800 (weak) to ~2200 (strong), center at 1500
  const min = 800;
  const max = 2200;
  return Math.max(0, Math.min(1, (rating - min) / (max - min)));
}

/** Normalize Glicko-2 RD (0-350) for radar uncertainty */
function normalize_rd(rd: number): number {
  return Math.max(0, Math.min(1, rd / 350));
}

export function render_dashboard(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page-content';
  page.id = 'page-dashboard';

  // Build initial skeleton
  page.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-md); flex-wrap: wrap;">
        <div>
          <h1 class="section-header__title">${t('dashboard.title')}</h1>
          <p class="section-header__subtitle" id="dashboard-subtitle"></p>
          <br>
        </div>
      </div>
    </div>

    <div class="stats-grid" id="dashboard-stats" style="margin-bottom: var(--space-xl);">
      <div class="glass-panel stat-card" id="stat-streak">
        <div class="stat-card__label">${t('dashboard.streak')}</div>
        <div class="stat-card__value stat-card__accent skeleton" id="stat-streak-value" style="width: 40px;">&nbsp;</div>
      </div>
      <div class="glass-panel stat-card" id="stat-sessions">
        <div class="stat-card__label">${t('dashboard.totalSessions')}</div>
        <div class="stat-card__value skeleton" id="stat-sessions-value" style="width: 60px;">&nbsp;</div>
      </div>
      <div class="glass-panel stat-card" id="stat-last">
        <div class="stat-card__label">${t('dashboard.lastSession')}</div>
        <div class="stat-card__value skeleton" id="stat-last-value" style="width: 80px;">&nbsp;</div>
      </div>
    </div>

    <div id="dashboard-due-section" style="display: none; margin-bottom: var(--space-xl);">
      <h2 class="radar-container__title" style="margin-bottom: var(--space-xs);">${t('dashboard.dueTitle')}</h2>
      <p style="color: var(--color-text-dim); font-size: 12px; margin-bottom: var(--space-md);">${t('dashboard.dueDesc')}</p>
      <div id="due-exercises-list" style="display: flex; gap: var(--space-md); overflow-x: auto; padding-bottom: 8px;">
        <!-- Dynamic due cards go here -->
      </div>
    </div>

    <div class="glass-panel radar-container" style="margin-bottom: var(--space-xl);">
      <h2 class="radar-container__title">${t('dashboard.radarTitle')}</h2>
      <div class="radar-layout">
        <div class="radar-canvas-wrapper">
          <canvas id="radar-canvas"></canvas>
        </div>
        <div class="pillar-cards-grid" id="pillar-cards">
          <!-- Dynamic pillar cards go here -->
        </div>
      </div>
      <p id="radar-empty" style="display:none; color: var(--color-text-tertiary); font-size: var(--font-size-sm); margin-top: var(--space-md); text-align: center;">
        ${t('dashboard.radarEmpty')}
      </p>
    </div>

    <div class="glass-panel" id="history-container" style="margin-bottom: var(--space-xl); padding: var(--space-lg);">
      <h2 class="radar-container__title" style="margin-bottom: var(--space-md);">${t('dashboard.historyTitle', { defaultValue: 'Longitudinal History' })}</h2>
      <div id="history-charts" style="display: flex; flex-direction: column; gap: var(--space-md); width: 100%;">
        <div style="height: 120px; width: 100%;"><canvas id="chart-focus"></canvas></div>
        <div style="height: 120px; width: 100%;"><canvas id="chart-accuracy"></canvas></div>
        <div style="height: 120px; width: 100%;"><canvas id="chart-rt"></canvas></div>
      </div>
      <p id="history-empty" style="display:none; color: var(--color-text-tertiary); font-size: var(--font-size-sm); margin-top: var(--space-md);">
        ${t('dashboard.historyEmpty')}
      </p>
    </div>

    <div class="glass-panel" style="margin-bottom: var(--space-xl); padding: var(--space-lg);">
      <h2 class="radar-container__title" style="margin-bottom: var(--space-md);">${t('dashboard.heatmapTitle')}</h2>
      <div style="height: 160px; width: 100%; position: relative;">
        <canvas id="chart-heatmap" style="width: 100%; height: 100%;"></canvas>
      </div>
      <p style="color: var(--color-text-tertiary); font-size: 11px; margin-top: var(--space-md); text-align: center;">
        ${t('dashboard.heatmapDesc')}
      </p>
    </div>

    <div class="glass-panel" style="margin-bottom: var(--space-xl); padding: var(--space-lg);">
      <h2 class="radar-container__title" style="margin-bottom: var(--space-md);">${t('dashboard.consistencyTitle', { defaultValue: 'Training Consistency' })}</h2>
      <div style="height: 160px; width: 100%; position: relative;">
        <canvas id="chart-calendar" style="width: 100%; height: 100%;"></canvas>
      </div>
    </div>

    <div class="glass-panel" id="community-section" style="margin-bottom: var(--space-xl); padding: var(--space-lg); border-color: hsla(280, 55%, 58%, 0.2);">
      <h2 class="radar-container__title" style="margin-bottom: var(--space-xs); color: var(--color-accent-tertiary);">${t('dashboard.communityTitle')}</h2>
      <p style="color: var(--color-text-dim); font-size: 12px; margin-bottom: var(--space-md);">${t('dashboard.communityDesc')}</p>
      <div id="community-benchmarks-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-md);">
        <!-- Dynamic community stats go here -->
      </div>
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
  const [profile, ratings, recentSessions, history, historyRaw, dueCards] = await Promise.all([
    get_profile(),
    get_ratings(),
    get_recent_sessions(1),
    get_sessions_history(30),
    get_sessions_raw(30),
    fsrsBridge.get_due_exercises(),
  ]);

  // Subtitle
  const subtitle = page.querySelector('#dashboard-subtitle');
  if (subtitle) {
    subtitle.textContent = profile && profile.totalSessions > 0
      ? t('dashboard.welcome')
      : t('dashboard.firstTimeDesc');
  }

  // Stats
  const streakEl = page.querySelector('#stat-streak-value') as HTMLElement | null;
  if (streakEl) {
    streakEl.classList.remove('skeleton');
    streakEl.style.width = 'auto';
    streakEl.textContent = profile ? t('dashboard.streakDays', { days: profile.currentStreak }) : '0';
  }

  const sessionsEl = page.querySelector('#stat-sessions-value') as HTMLElement | null;
  if (sessionsEl) {
    sessionsEl.classList.remove('skeleton');
    sessionsEl.style.width = 'auto';
    sessionsEl.textContent = String(profile?.totalSessions ?? 0);
  }

  const lastEl = page.querySelector('#stat-last-value') as HTMLElement | null;
  if (lastEl) {
    lastEl.classList.remove('skeleton');
    lastEl.style.width = 'auto';
    const lastSession = recentSessions[0];
    if (lastSession) {
      const date = new Date(lastSession.startedAt);
      lastEl.textContent = date.toLocaleDateString();
    } else {
      lastEl.textContent = t('dashboard.noSessions');
    }
  }

  // Pillar cards with Sparklines
  const pillarCardsGrid = page.querySelector('#pillar-cards') as HTMLElement;
  if (pillarCardsGrid) {
    pillarCardsGrid.innerHTML = '';
    const allPillars: CognitivePillar[] = ['WorkingMemory', 'CognitiveFlexibility', 'InhibitoryControl', 'SustainedAttention', 'ProcessingSpeed'];

    for (const p of allPillars) {
      const pMeta = PILLAR_META[p];
      const pRating = ratings.find(r => r.pillar === p);
      const pSessions = historyRaw.filter(s => s.pillar === p).slice(-7);

      const card = document.createElement('div');
      card.className = 'glass-panel pillar-card';
      card.style.borderColor = pMeta.color.replace(')', ', 0.2)');

      const slug = p.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

      card.innerHTML = `
        <div class="pillar-card__header">
          <span class="material-symbols-rounded" style="color: ${pMeta.color}; font-size: 18px;">${pMeta.icon}</span>
          <span class="pillar-card__name">${t(pMeta.labelKey)}</span>
        </div>
        <div class="pillar-card__body">
          <div class="pillar-card__rating">${Math.round(pRating?.rating ?? 1500)}</div>
          <div class="pillar-card__trend">
            <canvas id="spark-${p}" width="60" height="20"></canvas>
          </div>
        </div>
      `;

      card.addEventListener('click', () => router.navigate(`/pillar/${slug}`));
      pillarCardsGrid.appendChild(card);

      // Render micro-sparkline
      if (pSessions.length > 0) {
        setTimeout(() => {
          const spCanvas = page.querySelector(`#spark-${p}`) as HTMLCanvasElement;
          if (spCanvas) {
            const data = pSessions.map(s => s.accuracy);
            render_sparkline(spCanvas, data, { color: pMeta.color, height: 20 });
          }
        }, 0);
      }
    }
  }

  // Radar chart
  const canvas = page.querySelector('#radar-canvas') as HTMLCanvasElement | null;
  const emptyMsg = page.querySelector('#radar-empty') as HTMLElement | null;

  if (canvas) {
    const hasData = ratings.some((r: PillarRating) => r.rating !== GLICKO2_DEFAULTS.INITIAL_RATING);

    if (hasData) {
      const values: Record<CognitivePillar, number> = {} as Record<CognitivePillar, number>;
      const uncertainties: Record<CognitivePillar, number> = {} as Record<CognitivePillar, number>;
      for (const r of ratings) {
        values[r.pillar] = normalize_rating(r.rating);
        uncertainties[r.pillar] = normalize_rd(r.rd);
      }
      const isMobile = window.innerWidth < 768;
      const size = isMobile ? Math.min(260, window.innerWidth - 64) : 280;
      render_radar_chart(canvas, { values, uncertainties }, size);
      if (emptyMsg) emptyMsg.style.display = 'none';
    } else {
      // Show empty radar with default values
      const isMobile = window.innerWidth < 768;
      const size = isMobile ? Math.min(260, window.innerWidth - 64) : 280;
      render_radar_chart(canvas, {
        values: {
          WorkingMemory: 0.1,
          CognitiveFlexibility: 0.1,
          InhibitoryControl: 0.1,
          SustainedAttention: 0.1,
          ProcessingSpeed: 0.1,
        },
      }, size);
      if (emptyMsg) emptyMsg.style.display = 'block';
    }
  }

  // Render History
  const historyEmpty = page.querySelector('#history-empty') as HTMLElement;
  const historyCharts = page.querySelector('#history-charts') as HTMLElement;
  if (history.length >= 3) {
    if (historyEmpty) historyEmpty.style.display = 'none';
    if (historyCharts) historyCharts.style.display = 'flex';

    const locale = get_locale();
    const canvasFocus = page.querySelector('#chart-focus') as HTMLCanvasElement;
    const canvasAccuracy = page.querySelector('#chart-accuracy') as HTMLCanvasElement;
    const canvasRT = page.querySelector('#chart-rt') as HTMLCanvasElement;

    if (canvasFocus) {
      render_line_chart(canvasFocus, history, {
        metric: 'meanFocusScore',
        color: 'hsl(175, 70%, 50%)',
        label: t('dashboard.metricFocus'),
        locale
      });
    }
    if (canvasAccuracy) {
      render_line_chart(canvasAccuracy, history, {
        metric: 'meanAccuracy',
        color: 'hsl(210, 80%, 60%)',
        label: t('dashboard.metricAccuracy'),
        locale
      });
    }
    if (canvasRT) {
      render_line_chart(canvasRT, history, {
        metric: 'meanRT',
        color: 'hsl(20, 80%, 60%)',
        label: t('dashboard.metricRT'),
        isInverse: true,
        locale
      });
    }
  } else {
    if (historyEmpty) historyEmpty.style.display = 'block';
    if (historyCharts) historyCharts.style.display = 'none';
  }

  // Heatmap
  const canvasHeatmap = page.querySelector('#chart-heatmap') as HTMLCanvasElement;
  if (canvasHeatmap && historyRaw.length > 0) {
    const dayLabels = [
      t('day.sun'), t('day.mon'), t('day.tue'), t('day.wed'),
      t('day.thu'), t('day.fri'), t('day.sat')
    ];
    render_performance_heatmap(canvasHeatmap, historyRaw, { dayLabels });
  }

  // Consistency Calendar
  const canvasCalendar = page.querySelector('#chart-calendar') as HTMLCanvasElement;
  if (canvasCalendar && historyRaw.length > 0) {
    const dayLabelsShort: string[] = [
      t('day.sun')[0] || 'S', t('day.mon')[0] || 'M', t('day.tue')[0] || 'T', t('day.wed')[0] || 'W',
      t('day.thu')[0] || 'T', t('day.fri')[0] || 'F', t('day.sat')[0] || 'S'
    ];
    render_calendar_heatmap(canvasCalendar, historyRaw, { 
      months: 6,
      locale: get_locale(),
      dayLabels: dayLabelsShort
    });
  }

  // Render Due Today
  const dueSection = page.querySelector('#dashboard-due-section') as HTMLElement;
  const dueList = page.querySelector('#due-exercises-list') as HTMLElement;
  if (dueSection && dueList && dueCards.length > 0) {
    dueSection.style.display = 'block';
    dueList.innerHTML = '';

    for (const card of dueCards) {
      const exercise = EXERCISES.find(e => e.type === card.exerciseType);
      if (!exercise) continue;

      const cardEl = document.createElement('div');
      cardEl.className = 'glass-panel due-exercise-card';
      const currentR = get_current_retrievability(card);
      const rPercent = Math.round(currentR * 100);
      const rColor = currentR > 0.8 ? 'var(--color-success)' : 'var(--color-warning)';

      cardEl.innerHTML = `
        <span class="icon" style="font-size: 24px;">${exercise.iconGlyph}</span>
        <span style="font-size: 12px; font-weight: 600; text-align: center;">${t(exercise.nameKey)}</span>
        <div style="font-size: 10px; color: ${rColor}; font-weight: 700;">${rPercent}% ${t('dashboard.retrievability', { defaultValue: 'R' })}</div>
      `;

      cardEl.addEventListener('click', () => {
        start_exercise_session(exercise.type);
      });

      dueList.appendChild(cardEl);
    }
  }

  // Render Community Benchmarks
  const communityList = page.querySelector('#community-benchmarks-list') as HTMLElement;
  if (communityList) {
    const benchmarks = await syncManager.get_community_benchmarks();
    if (benchmarks) {
      communityList.innerHTML = '';
      for (const [pillar, avg] of Object.entries(benchmarks)) {
        const meta = PILLAR_META[pillar as CognitivePillar];
        if (!meta) continue;

        const statEl = document.createElement('div');
        statEl.className = 'glass-panel community-stat-card';
        statEl.style.borderLeft = `3px solid ${meta.color}`;

        statEl.innerHTML = `
          <div style="font-size: 10px; color: var(--color-text-tertiary); text-transform: uppercase; font-weight: 600;">
            ${t(meta.labelKey)}
          </div>
          <div style="display: flex; align-items: baseline; gap: 6px;">
            <div style="font-size: 18px; font-weight: 800; color: var(--color-text-primary);">${Math.round(avg as number)}</div>
            <div style="font-size: 10px; color: var(--color-text-tertiary);">${t('dashboard.communityAvg')}</div>
          </div>
        `;
        communityList.appendChild(statEl);
      }
    } else {
      const communitySection = page.querySelector('#community-section') as HTMLElement;
      if (communitySection) communitySection.style.display = 'none';
    }
  }
}
