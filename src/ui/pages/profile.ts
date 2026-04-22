// ============================================================
// NeuroSustain — Profile Page
// User statistics and locale settings
// ============================================================

import { t, get_locale, set_locale } from '@shared/i18n.ts';
import { get_profile, export_data_json, export_data_csv, import_data_json, db } from '@shared/db.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import type { Locale } from '@shared/types.ts';

export function render_profile(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page-content';
  page.id = 'page-profile';

  page.innerHTML = `
    <div class="section-header">
      <h1 class="section-header__title">${t('profile.title')}</h1>
    </div>
    <div class="profile-section glass-panel" style="padding: var(--space-lg);" id="profile-fields">
      <div class="profile-field">
        <span class="profile-field__label">${t('profile.language')}</span>
        <div class="locale-switcher">
          <button class="locale-btn ${get_locale() === 'en' ? 'locale-btn--active' : ''}"
                  data-locale="en" id="locale-btn-en">English</button>
          <button class="locale-btn ${get_locale() === 'es' ? 'locale-btn--active' : ''}"
                  data-locale="es" id="locale-btn-es">Español</button>
        </div>
      </div>
      <div class="profile-field">
        <span class="profile-field__label">${t('profile.memberSince')}</span>
        <span class="profile-field__value" id="profile-member-since">—</span>
      </div>
      <div class="profile-field">
        <span class="profile-field__label">${t('profile.totalSessions')}</span>
        <span class="profile-field__value" id="profile-total-sessions">—</span>
      </div>
      <div class="profile-field">
        <span class="profile-field__label">${t('profile.currentStreak')}</span>
        <span class="profile-field__value" id="profile-current-streak">—</span>
      </div>
      <div class="profile-field">
        <span class="profile-field__label">${t('profile.longestStreak')}</span>
        <span class="profile-field__value" id="profile-longest-streak">—</span>
      </div>
      <div class="profile-field">
        <span class="profile-field__label">${t('profile.audioFocus', { defaultValue: 'Focus Ambience Audio' })}</span>
        <input type="checkbox" id="toggle-audio-focus" style="transform: scale(1.2);" />
      </div>
      <div class="profile-field">
        <span class="profile-field__label" style="color: var(--color-warning);">[DEBUG] Override Difficulty (1-10)</span>
        <input type="number" id="debug-difficulty-input" min="1" max="10" placeholder="Auto" style="width: 80px; text-align: center; background: var(--bg-secondary); color: white; border: 1px solid var(--glass-border); border-radius: 4px; padding: 4px;" />
      </div>
      <div class="profile-field" style="border-bottom: none; flex-direction: column; align-items: flex-start; gap: var(--space-sm);">
        <span class="profile-field__label">${t('profile.dataSovereignty', { defaultValue: 'Data Sovereignty' })}</span>
        <div style="display: flex; gap: var(--space-sm); margin-top: var(--space-xs);">
          <button class="btn btn--ghost btn--small" id="btn-export-json">Export JSON</button>
          <button class="btn btn--ghost btn--small" id="btn-export-csv">Export CSV</button>
          <button class="btn btn--ghost btn--small" id="btn-import-json">Import JSON</button>
          <input type="file" id="file-import-json" accept=".json" style="display: none;" />
        </div>
      </div>
    </div>
  `;

  // Locale switching
  const localeButtons = page.querySelectorAll('.locale-btn');
  localeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const locale = (btn as HTMLElement).dataset['locale'] as Locale;
      await set_locale(locale);
      // Force full re-render via router
      window.location.hash = '/profile';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });

  // Populate async
  _populate_profile(page);

  // Audio Toggle
  const audioToggle = page.querySelector('#toggle-audio-focus') as HTMLInputElement;
  audioToggle?.addEventListener('change', async () => {
    const enabled = audioToggle.checked;
    const profile = await get_profile();
    if (profile?.id != null) {
      await db.profile.update(profile.id, { audioFocusAmbience: enabled });
      if (enabled) {
        audioEngine.start_ambience();
      } else {
        audioEngine.stop_ambience();
      }
    }
  });

  // Debug Difficulty
  const debugInput = page.querySelector('#debug-difficulty-input') as HTMLInputElement;
  if (debugInput) {
    const currentDebug = localStorage.getItem('DEBUG_DIFFICULTY');
    if (currentDebug) debugInput.value = currentDebug;
    
    debugInput.addEventListener('change', () => {
      const val = parseInt(debugInput.value, 10);
      if (!isNaN(val) && val >= 1 && val <= 10) {
        localStorage.setItem('DEBUG_DIFFICULTY', val.toString());
      } else {
        debugInput.value = '';
        localStorage.removeItem('DEBUG_DIFFICULTY');
      }
    });
  }

  // Data Sovereignty Bindings
  page.querySelector('#btn-export-json')?.addEventListener('click', async () => {
    const json = await export_data_json();
    _download_file(json, 'neurosustain-backup.json', 'application/json');
  });

  page.querySelector('#btn-export-csv')?.addEventListener('click', async () => {
    const csv = await export_data_csv();
    _download_file(csv, 'neurosustain-sessions.csv', 'text/csv');
  });

  const fileInput = page.querySelector('#file-import-json') as HTMLInputElement;
  page.querySelector('#btn-import-json')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content) {
        try {
          await import_data_json(content);
          alert('Data imported successfully. Reloading...');
          window.location.reload();
        } catch (err) {
          alert('Failed to import data: ' + err);
        }
      }
    };
    reader.readAsText(file);
  });

  return page;
}

function _download_file(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function _populate_profile(page: HTMLElement): Promise<void> {
  const profile = await get_profile();
  if (!profile) return;

  const memberSince = page.querySelector('#profile-member-since');
  if (memberSince) {
    memberSince.textContent = new Date(profile.createdAt).toLocaleDateString();
  }

  const totalSessions = page.querySelector('#profile-total-sessions');
  if (totalSessions) {
    totalSessions.textContent = String(profile.totalSessions);
  }

  const currentStreak = page.querySelector('#profile-current-streak');
  if (currentStreak) {
    currentStreak.textContent = t('dashboard.streakDays', { days: profile.currentStreak });
  }

  const longestStreak = page.querySelector('#profile-longest-streak');
  if (longestStreak) {
    longestStreak.textContent = t('dashboard.streakDays', { days: profile.longestStreak });
  }

  const audioToggle = page.querySelector('#toggle-audio-focus') as HTMLInputElement;
  if (audioToggle) {
    audioToggle.checked = profile.audioFocusAmbience ?? false;
  }
}
