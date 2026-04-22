// ============================================================
// NeuroSustain — Profile Page
// User statistics and locale settings
// ============================================================

import { t, get_locale, set_locale } from '@shared/i18n.ts';
import { get_profile } from '@shared/db.ts';
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
      <div class="profile-field" style="border-bottom: none;">
        <span class="profile-field__label">${t('profile.longestStreak')}</span>
        <span class="profile-field__value" id="profile-longest-streak">—</span>
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

  return page;
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
}
