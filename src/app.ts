// ============================================================
// NeuroSustain — Application Entry Point
// Boot sequence:
//   1. DB init + schema migration
//   2. System C: Recover orphaned FSRS journal entries
//   3. i18n initialization
//   4. System A: Hardware calibration (first launch only)
//   5. Route registration + app shell render
// ============================================================

import './index.css';
import { initialize_db, recover_orphaned_journals, get_hardware_profile } from '@shared/db.ts';
import { init_i18n } from '@shared/i18n.ts';
import { router } from '@ui/router.ts';
import { render_dashboard } from '@ui/pages/dashboard.ts';
import { render_train } from '@ui/pages/train.ts';
import { render_profile } from '@ui/pages/profile.ts';
import { show_loading, hide_loading } from '@ui/components/loading-screen.ts';
import { show_calibration_screen } from '@ui/components/calibration-screen.ts';

// Register Web Components
import '@ui/components/sidebar.ts';

async function boot(): Promise<void> {
  show_loading('loading.syncing');

  try {
    // 1. Initialize persistence layer (runs Dexie migrations if needed)
    await initialize_db();

    // 2. System C: Check for orphaned FSRS journal entries from crashed sessions
    const overlayText = document.querySelector('.loading-overlay__text');
    if (overlayText) overlayText.textContent = 'Checking neural data integrity...';

    const recovered = await recover_orphaned_journals();
    if (recovered > 0) {
      console.info(`[Boot] Recovered ${recovered} interrupted FSRS calibration(s).`);
    }

    // 3. Initialize i18n (reads locale from IndexedDB profile)
    await init_i18n();

    // 4. Register routes
    router.register({ path: '/dashboard', title: 'Dashboard', render: render_dashboard });
    router.register({ path: '/train',     title: 'Train',     render: render_train });
    router.register({ path: '/profile',   title: 'Profile',   render: render_profile });

    // 5. Build app shell
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <ns-sidebar></ns-sidebar>
        <main id="page-container"></main>
      `;
    }

    hide_loading();

    // 6. System A: First-launch hardware calibration
    // Check AFTER hiding loading screen so the calibration UI is visible
    const hwProfile = await get_hardware_profile();
    if (!hwProfile) {
      // First launch — run calibration before the first exercise is accessible
      show_calibration_screen((_profile) => {
        // Navigate to dashboard after calibration completes
        router.navigate('/dashboard');
      });
    } else {
      // Returning user — trigger normal route
      if (!window.location.hash) {
        router.navigate('/dashboard');
      } else {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }
  } catch (err) {
    console.error('NeuroSustain boot failed:', err);
    hide_loading();
  }
}

boot();
