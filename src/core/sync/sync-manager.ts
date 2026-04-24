// ============================================================
// NeuroSustain — Cloud Sync Manager
// Handles eventual consistency between Dexie and Supabase.
// ============================================================

import { db } from '@shared/db.ts';
import { supabase } from './supabase-client.ts';

export class SyncManager {
  private _isSyncing = false;

  /** Run a full sync cycle */
  async sync(): Promise<void> {
    if (!supabase || this._isSyncing) return;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    this._isSyncing = true;
    console.log('[Sync] Starting sync cycle...');

    try {
      await this._sync_profile(session.user.id);
      await this._sync_ratings(session.user.id);
      await this._sync_sessions(session.user.id);
      console.log('[Sync] Sync cycle completed successfully.');
    } catch (err) {
      console.error('[Sync] Sync cycle failed:', err);
    } finally {
      this._isSyncing = false;
    }
  }

  private async _sync_profile(userId: string): Promise<void> {
    const profile = await db.profile.toCollection().first();
    if (!profile) return;

    const { error } = await supabase!
      .from('profiles')
      .upsert({
        id: userId,
        total_sessions: profile.totalSessions,
        current_streak: profile.currentStreak,
        longest_streak: profile.longestStreak,
        last_session_date: profile.lastSessionDate,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
  }

  private async _sync_ratings(userId: string): Promise<void> {
    const ratings = await db.ratings.toArray();
    if (ratings.length === 0) return;

    const payload = ratings.map(r => ({
      user_id: userId,
      pillar: r.pillar,
      rating: r.rating,
      rd: r.rd,
      volatility: r.volatility,
      last_updated: new Date(r.lastUpdated).toISOString(),
    }));

    const { error } = await supabase!
      .from('ratings')
      .upsert(payload, { onConflict: 'user_id, pillar' });

    if (error) throw error;
  }

  private async _sync_sessions(userId: string): Promise<void> {
    // 1. Get unsynced sessions
    const unsynced = await db.sessions.where('isSynced').equals(0).toArray();
    if (unsynced.length === 0) return;

    console.log(`[Sync] Uploading ${unsynced.length} unsynced sessions...`);

    for (const s of unsynced) {
      const { error } = await supabase!
        .from('sessions')
        .insert({
          user_id: userId,
          session_id: s.sessionId,
          exercise_type: s.exerciseType,
          pillar: s.pillar,
          accuracy: s.accuracy,
          mean_rt: s.meanReactionTimeMs,
          focus_score: s.focusScore,
          started_at: new Date(s.startedAt).toISOString(),
        });

      if (!error) {
        await db.sessions.update(s.id!, { isSynced: 1 });
      } else {
        console.warn(`[Sync] Failed to upload session ${s.sessionId}:`, error.message);
      }
    }
  }
}

export const syncManager = new SyncManager();
