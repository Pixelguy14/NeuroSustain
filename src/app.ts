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

import { syncManager } from '@core/sync/sync-manager.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import { toast } from '@ui/components/toast.ts';

// Register Web Components
import '@ui/components/sidebar.ts';

// Global Audio Context Unlock & Interaction Tracking (iOS/Safari Requirement)
let audioUnlocked = false;
window.addEventListener('pointerdown', async () => {
  if (audioUnlocked) return;
  await audioEngine.unlock();
  audioUnlocked = true;
  console.info('[Audio] Global context unlocked via user gesture.');
  
  // Also start ambience if enabled on first interaction
  if (audioEngine.enabled) {
    audioEngine.start_ambience();
  }
}, { once: true });

// Global Cloud Sync Monitoring
syncManager.subscribe((status, err) => {
  if (status === 'success') {
    toast.show('Cloud Sync Complete', 'success');
  } else if (status === 'error') {
    toast.show('Sync Failed - Tap to Retry', 'error');
    console.error('Cloud Sync Error:', err);
  }
});

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

    // Pillar Detail Routes
    const { render_pillar_detail } = await import('@ui/pages/pillar-detail.ts');
    router.register({ path: '/pillar/working-memory', title: 'Working Memory', render: () => render_pillar_detail('WorkingMemory') });
    router.register({ path: '/pillar/cognitive-flexibility', title: 'Cognitive Flexibility', render: () => render_pillar_detail('CognitiveFlexibility') });
    router.register({ path: '/pillar/inhibitory-control', title: 'Inhibitory Control', render: () => render_pillar_detail('InhibitoryControl') });
    router.register({ path: '/pillar/sustained-attention', title: 'Sustained Attention', render: () => render_pillar_detail('SustainedAttention') });
    router.register({ path: '/pillar/processing-speed', title: 'Processing Speed', render: () => render_pillar_detail('ProcessingSpeed') });

    // Baseline Onboarding
    const { render_baseline } = await import('@ui/pages/baseline.ts');
    router.register({ path: '/baseline', title: 'Onboarding', render: () => render_baseline(0) });

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
      // Returning user — check if they need baseline
      const { get_sessions_raw } = await import('@shared/db.ts');
      const sessions = await get_sessions_raw(1);
      
      if (sessions.length === 0) {
        router.navigate('/baseline');
      } else if (!window.location.hash) {
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

// Global Mouse Tracking for Reactive Glow (Pillar 3)
window.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth) * 100;
  const y = (e.clientY / window.innerHeight) * 100;
  document.documentElement.style.setProperty('--mouse-x', `${x}%`);
  document.documentElement.style.setProperty('--mouse-y', `${y}%`);
});

boot();
