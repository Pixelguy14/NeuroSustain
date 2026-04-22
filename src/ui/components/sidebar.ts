// ============================================================
// NeuroSustain — Sidebar Navigation Web Component
// ============================================================

import { t, on_locale_change } from '@shared/i18n.ts';
import { router } from '../router.ts';

interface NavItem {
  path: string;
  labelKey: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', labelKey: 'nav.dashboard', icon: '📊' },
  { path: '/train', labelKey: 'nav.train', icon: '🧠' },
  { path: '/profile', labelKey: 'nav.profile', icon: '👤' },
];

export class SidebarNav extends HTMLElement {
  private _unsubLocale?: () => void;
  private _unsubRoute?: () => void;

  connectedCallback(): void {
    this._render();
    this._unsubLocale = on_locale_change(() => this._render());
    this._unsubRoute = router.on_change(() => this._update_active());
  }

  disconnectedCallback(): void {
    this._unsubLocale?.();
    this._unsubRoute?.();
  }

  private _render(): void {
    this.innerHTML = `
      <aside class="sidebar" id="sidebar-nav">
        <div class="sidebar__brand">
          <div class="sidebar__logo">N</div>
          <span class="sidebar__title">${t('app.name')}</span>
        </div>
        <nav class="sidebar__nav" role="navigation" aria-label="Main navigation">
          ${NAV_ITEMS.map(item => `
            <a href="#${item.path}"
               class="sidebar__link ${router.currentPath === item.path ? 'sidebar__link--active' : ''}"
               data-path="${item.path}"
               id="nav-${item.path.slice(1)}">
              <span class="sidebar__link-icon">${item.icon}</span>
              <span>${t(item.labelKey)}</span>
            </a>
          `).join('')}
        </nav>
        <div class="sidebar__footer">
          <span class="sidebar__version">v0.1.4 · Sprint 4</span>
        </div>
      </aside>
    `;
  }

  private _update_active(): void {
    const links = this.querySelectorAll('.sidebar__link');
    links.forEach(link => {
      const path = (link as HTMLElement).dataset['path'];
      link.classList.toggle('sidebar__link--active', path === router.currentPath);
    });
  }
}

customElements.define('ns-sidebar', SidebarNav);
