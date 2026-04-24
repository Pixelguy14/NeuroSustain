// ============================================================
// NeuroSustain — Profile Page
// User statistics and locale settings
// ============================================================

import { t, get_locale, set_locale } from '@shared/i18n.ts';
import { get_profile, export_data_json, export_data_csv, import_data_json, clear_all_data, db } from '@shared/db.ts';
import { calculate_percentile } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import { supabase } from '@core/sync/supabase-client.ts';
import { syncManager } from '@core/sync/sync-manager.ts';
import { export_clinical_report } from '@core/analytics/pdf-export.ts';
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
      <div class="profile-field" style="flex-direction: column; align-items: flex-start; gap: var(--space-sm);">
        <span class="profile-field__label">${t('profile.difficulties')}</span>
        <div id="profile-pillar-ratings" style="width: 100%; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--space-sm); margin-top: var(--space-xs);">
          <!-- Dynamic pillar ratings go here -->
        </div>
      </div>
      <div class="profile-field" style="border-bottom: none; flex-direction: column; align-items: flex-start; gap: var(--space-sm);">
        <span class="profile-field__label">${t('profile.dataSovereignty')}</span>
        <div style="display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-xs);">
          <button class="btn btn--primary btn--small" id="btn-export-pdf" style="background: hsla(175, 70%, 50%, 0.15); border-color: hsla(175, 70%, 50%, 0.3); color: hsl(175, 70%, 70%);">
            ${t('profile.downloadReport', { defaultValue: 'Download Clinical PDF' })}
          </button>
          <button class="btn btn--ghost btn--small" id="btn-export-json">JSON</button>
          <button class="btn btn--ghost btn--small" id="btn-export-csv">CSV</button>
          <button class="btn btn--ghost btn--small" id="btn-import-json">${t('profile.import')}</button>
          <input type="file" id="file-import-json" accept=".json" style="display: none;" />
        </div>
      </div>
      <div class="profile-field" style="border-bottom: none; flex-direction: column; align-items: flex-start; gap: var(--space-sm); margin-top: var(--space-md); padding-top: var(--space-md); border-top: 1px solid hsla(0, 0%, 100%, 0.1);">
        <span class="profile-field__label">${t('profile.syncTitle')}</span>
        <p style="font-size: 12px; color: var(--color-text-dim); margin-bottom: var(--space-sm);">${t('profile.syncDesc')}</p>
        <div id="sync-controls" style="display: flex; flex-direction: column; gap: var(--space-md); width: 100%;">
          <!-- Auth/Sync controls go here -->
        </div>
      </div>
      <div class="profile-field" style="border-bottom: none; flex-direction: column; align-items: flex-start; gap: var(--space-sm); margin-top: var(--space-md); padding-top: var(--space-md); border-top: 1px solid hsla(0, 0%, 100%, 0.1);">
        <span class="profile-field__label" style="color: var(--color-error);">${t('profile.deleteData')}</span>
        <p style="font-size: 12px; color: var(--color-text-dim); margin-bottom: var(--space-sm);">${t('profile.deleteConfirm')}</p>
        <button class="btn btn--danger btn--small" id="btn-delete-all" style="background: hsla(0, 80%, 50%, 0.2); border-color: hsla(0, 80%, 50%, 0.4); color: hsl(0, 90%, 70%);">
          ${t('profile.deleteButton')}
        </button>
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
  page.querySelector('#btn-export-pdf')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-export-pdf') as HTMLButtonElement;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      await export_clinical_report();
    } catch (err) {
      console.error('PDF Export failed:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

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

  // Delete All Data
  page.querySelector('#btn-delete-all')?.addEventListener('click', async () => {
    if (confirm(t('profile.deleteConfirm'))) {
      await clear_all_data();
      localStorage.clear(); // Clear debug flags too
      window.location.href = '/'; // Go home
      window.location.reload();
    }
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

  // Populate Pillar Ratings
  const ratings = await db.ratings.toArray();
  const ratingsContainer = page.querySelector('#profile-pillar-ratings');
  if (ratingsContainer) {
    ratingsContainer.innerHTML = '';
    
    // Sort by rating desc
    ratings.sort((a, b) => b.rating - a.rating);

    if (ratings.length === 0) {
      ratingsContainer.innerHTML = `<p style="color: var(--color-text-dim); font-size: 13px;">${t('dashboard.noSessions')}</p>`;
    }

    for (const r of ratings) {
      const card = document.createElement('div');
      card.style.cssText = `
        background: hsla(225, 30%, 12%, 0.4);
        border: 1px solid hsla(175, 70%, 50%, 0.15);
        border-radius: 8px;
        padding: var(--space-sm) var(--space-md);
        display: flex;
        flex-direction: column;
        gap: 4px;
      `;
      
      const difficulty = Math.max(1, Math.min(10, ((r.rating - 1300) / 100) + 1)).toFixed(1);
      const percentile = calculate_percentile(r.rating);
      
      card.innerHTML = `
        <span style="font-size: 11px; color: var(--color-text-dim); text-transform: uppercase; letter-spacing: 0.05em;">${t(`pillar.${r.pillar}`)}</span>
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-xs);">
          <div style="display: flex; align-items: baseline; gap: 4px;">
            <span style="font-size: 20px; font-weight: 700; color: hsl(175, 70%, 60%);">LV ${difficulty}</span>
            <span style="font-size: 12px; color: hsla(175, 70%, 50%, 0.4);">/ 10</span>
          </div>
          <span style="font-size: 11px; font-weight: 600; color: hsla(45, 90%, 60%, 0.8); background: hsla(45, 90%, 55%, 0.1); padding: 2px 6px; border-radius: 4px;">
            ${percentile >= 50 ? `Top ${100 - percentile}%` : `${percentile}% ${t('profile.percentile', { defaultValue: 'Percentile' })}`}
          </span>
        </div>
      `;
      ratingsContainer.appendChild(card);
    }
  }

  // Populate Sync Section
  const syncControls = page.querySelector('#sync-controls');
  const s = supabase;
  if (syncControls && s) {
    const { data: { session } } = await s.auth.getSession();
    
    if (session) {
      syncControls.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; background: hsla(145, 65%, 48%, 0.05); padding: var(--space-sm); border-radius: 4px; border: 1px solid hsla(145, 65%, 48%, 0.2);">
          <span style="font-size: 11px; color: var(--color-success); font-weight: 600;">${t('profile.syncStatus')}: ONLINE</span>
          <span style="font-size: 11px; color: var(--color-text-dim);">${session.user.email}</span>
        </div>
        <div style="display: flex; gap: var(--space-sm);">
          <button class="btn btn--primary btn--small" id="btn-sync-now" style="flex: 1;">${t('profile.syncNow')}</button>
          <button class="btn btn--ghost btn--small" id="btn-logout">${t('profile.syncLogout')}</button>
        </div>
      `;

      page.querySelector('#btn-sync-now')?.addEventListener('click', async () => {
        const btn = page.querySelector('#btn-sync-now') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = '...';
        await syncManager.sync();
        btn.disabled = false;
        btn.textContent = t('profile.syncNow');
      });

      page.querySelector('#btn-logout')?.addEventListener('click', async () => {
        await s.auth.signOut();
        window.location.reload();
      });
    } else {
      syncControls.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
          <input type="email" id="sync-email" placeholder="email@example.com" style="background: var(--color-bg-tertiary); border: 1px solid var(--glass-border); border-radius: 4px; padding: 10px; color: white;" />
          <button class="btn btn--primary btn--small" id="btn-login">${t('profile.syncLogin')}</button>
        </div>
      `;

      page.querySelector('#btn-login')?.addEventListener('click', async () => {
        const email = (page.querySelector('#sync-email') as HTMLInputElement).value;
        if (!email) return;
        
        const btn = page.querySelector('#btn-login') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = '...';
        
        const { error } = await s.auth.signInWithOtp({ 
          email,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname
          }
        });
        if (error) {
          alert(error.message);
          btn.disabled = false;
          btn.textContent = t('profile.syncLogin');
        } else {
          alert('Magic link sent! Check your email.');
          btn.textContent = 'Link Sent';
        }
      });
    }
  } else if (syncControls) {
    syncControls.innerHTML = `
      <p style="font-size: 11px; color: var(--color-warning); background: hsla(38, 90%, 55%, 0.1); padding: 8px; border-radius: 4px; border: 1px solid hsla(38, 90%, 55%, 0.2);">
        Supabase keys missing. Check .env
      </p>
    `;
  }
}
