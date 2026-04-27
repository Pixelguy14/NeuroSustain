// ============================================================
// NeuroSustain — Notification Manager
// Logic for requesting permissions and scheduling smart reminders
// based on cognitive peak hours (Neural Rhythm).
// ============================================================

import { get_sessions_raw } from '@shared/db.ts';
import { t } from '@shared/i18n.ts';

export class NotificationManager {
  /** Request browser permission for notifications */
  async request_permission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported by this browser.');
      return false;
    }
    
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (err) {
      console.error('Failed to request notification permission:', err);
      return false;
    }
  }

  /** 
   * Analyze heatmap data to find the user's cognitive peak hour 
   * and suggest it for training.
   */
  async get_peak_hour(): Promise<number> {
    const sessions = await get_sessions_raw(100);
    if (sessions.length < 5) return 10; // Default to 10 AM if not enough data

    const hourStats = Array(24).fill(0).map(() => ({ sum: 0, count: 0 }));
    for (const s of sessions) {
      const hour = new Date(s.startedAt).getHours();
      hourStats[hour]!.sum += s.focusScore;
      hourStats[hour]!.count++;
    }

    let peakHour = 10;
    let maxFocus = -1;

    for (let h = 0; h < 24; h++) {
      const stat = hourStats[h]!;
      if (stat.count > 0) {
        const avg = stat.sum / stat.count;
        if (avg > maxFocus) {
          maxFocus = avg;
          peakHour = h;
        }
      }
    }

    return peakHour;
  }

  /**
   * Schedules a reminder. In this prototype, we use the Notification API directly.
   * In a full production PWA, this would involve a Service Worker push event.
   */
  async schedule_test_notification(): Promise<void> {
    if (Notification.permission !== 'granted') return;

    const peak = await this.get_peak_hour();
    
    // Create a local notification as a proof of concept
    new Notification('NeuroSustain', {
      body: t('notifications.smartReminder', { 
        defaultValue: `Your neural pathways are most receptive at ${peak}:00. Ready to train?` 
      }),
      icon: '/favicon.svg',
      tag: 'smart-reminder'
    });
  }
}

export const notificationManager = new NotificationManager();
