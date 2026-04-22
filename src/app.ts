// ============================================================
// NeuroSustain — Application Entry Point
// Initializes DB, i18n, routes, and Web Components
// ============================================================

import './index.css';
import { initialize_db } from '@shared/db.ts';
import { init_i18n } from '@shared/i18n.ts';
import { router } from '@ui/router.ts';
import { render_dashboard } from '@ui/pages/dashboard.ts';
import { render_train } from '@ui/pages/train.ts';
import { render_profile } from '@ui/pages/profile.ts';
import { show_loading, hide_loading } from '@ui/components/loading-screen.ts';

// Register Web Components
import '@ui/components/sidebar.ts';

async function boot(): Promise<void> {
  show_loading('loading.syncing');

  try {
    // Initialize persistence layer
    await initialize_db();

    // Initialize i18n (reads locale from IndexedDB profile)
    await init_i18n();

    // Register routes
    router.register({ path: '/dashboard', title: 'Dashboard', render: render_dashboard });
    router.register({ path: '/train',     title: 'Train',     render: render_train });
    router.register({ path: '/profile',   title: 'Profile',   render: render_profile });

    // Build app shell
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <ns-sidebar></ns-sidebar>
        <main id="page-container"></main>
      `;
    }

    hide_loading();

    // Trigger initial route
    if (!window.location.hash) {
      router.navigate('/dashboard');
    } else {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  } catch (err) {
    console.error('NeuroSustain boot failed:', err);
    hide_loading();
  }
}

boot();
