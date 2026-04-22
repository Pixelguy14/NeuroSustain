// ============================================================
// NeuroSustain — Loading Screen Component
// Displays actionable neuroscience insights during transitions
// ============================================================

import { t } from '@shared/i18n.ts';

const INSIGHT_KEYS = [
  'insight.attention',
  'insight.sleep',
  'insight.exercise',
  'insight.hydration',
  'insight.dual',
  'insight.neuroplasticity',
  'insight.aiDependency',
  'insight.contextSwitch',
];

let _loadingOverlay: HTMLElement | null = null;

/** Show the loading overlay with a random insight */
export function show_loading(statusKey: string = 'loading.syncing'): void {
  if (_loadingOverlay) return;

  const insightKey = INSIGHT_KEYS[Math.floor(Math.random() * INSIGHT_KEYS.length)]!;

  _loadingOverlay = document.createElement('div');
  _loadingOverlay.className = 'loading-overlay';
  _loadingOverlay.id = 'loading-overlay';
  _loadingOverlay.innerHTML = `
    <div class="loading-overlay__spinner"></div>
    <p class="loading-overlay__text">${t(statusKey)}</p>
    <p class="loading-overlay__insight">${t(insightKey)}</p>
  `;

  document.body.appendChild(_loadingOverlay);
}

/** Hide the loading overlay with fade out */
export function hide_loading(): void {
  if (!_loadingOverlay) return;

  _loadingOverlay.style.opacity = '0';
  _loadingOverlay.style.transition = 'opacity 0.3s ease-out';

  setTimeout(() => {
    _loadingOverlay?.remove();
    _loadingOverlay = null;
  }, 300);
}
