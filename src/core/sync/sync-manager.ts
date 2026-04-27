// ============================================================
// NeuroSustain — Cloud Sync Manager
// Handles eventual consistency between Dexie and Supabase.
// ============================================================

import { db } from '@shared/db.ts';
import { supabase } from './supabase-client.ts';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';
export type SyncCallback = (status: SyncStatus, error?: any) => void;

export class SyncManager {
  private _isSyncing = false;
  private _listeners: SyncCallback[] = [];

  /** Subscribe to sync status changes */
  subscribe(cb: SyncCallback): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter(l => l !== cb);
    };
  }

  private _notify(status: SyncStatus, error?: any): void {
    this._listeners.forEach(l => l(status, error));
  }

  /** Run a full sync cycle */
  async sync(): Promise<void> {
    if (!supabase || this._isSyncing) return;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    this._isSyncing = true;
    this._notify('syncing');
    console.log('[Sync] Starting sync cycle...');

    try {
      const profileId = await this._sync_profile(session.user.id);
      await this._sync_ratings(profileId);
      await this._sync_sessions(profileId);
      
      this._notify('success');
      console.log('[Sync] Sync cycle completed successfully.');
    } catch (err) {
      this._notify('error', err);
      console.error('[Sync] Sync cycle failed:', err);
    } finally {
      this._isSyncing = false;
    }
  }

  private async _sync_profile(userId: string): Promise<string> {
    const profile = await db.profile.toCollection().first();
    if (!profile) throw new Error('Local profile not found');

    const { data, error } = await supabase!
      .from('profiles')
      .upsert({
        user_id: userId,
        total_sessions: profile.totalSessions,
        current_streak: profile.currentStreak,
        longest_streak: profile.longestStreak,
        last_session_date: profile.lastSessionDate,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  private async _sync_ratings(profileId: string): Promise<void> {
    const ratings = await db.ratings.toArray();
    if (ratings.length === 0) return;

    const payload = ratings.map(r => ({
      profile_id: profileId,
      pillar: r.pillar,
      rating: r.rating,
      rd: r.rd,
      volatility: r.volatility,
      last_updated: new Date(r.lastUpdated).toISOString(),
    }));

    const { error } = await supabase!
      .from('ratings')
      .upsert(payload, { onConflict: 'profile_id, pillar' });

    if (error) throw error;
  }

  private async _sync_sessions(profileId: string): Promise<void> {
    // 1. Get unsynced sessions
    const unsynced = await db.sessions.where('isSynced').equals(0).toArray();
    if (unsynced.length === 0) return;

    console.log(`[Sync] Uploading ${unsynced.length} unsynced sessions...`);

    for (const s of unsynced) {
      const { error } = await supabase!
        .from('sessions')
        .insert({
          profile_id: profileId,
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

  /** Fetch global anonymous benchmarks for community comparison */
  async get_community_benchmarks(): Promise<Record<string, number> | null> {
    if (!supabase) return null;
    
    // In a real production app, this would be a RPC call or a dedicated public view
    // to avoid RLS restrictions and ensure privacy.
    try {
      const { data, error } = await supabase
        .from('global_benchmarks')
        .select('pillar, average_rating')
        .limit(5);

      if (error || !data) {
        // Silently fall back if table doesn't exist (404) or is empty
        return this._get_mock_benchmarks();
      }

      return data.reduce((acc: any, row: any) => {
        acc[row.pillar] = row.average_rating;
        return acc;
      }, {});
    } catch {
      return this._get_mock_benchmarks();
    }
  }

  private _get_mock_benchmarks(): Record<string, number> {
    return {
      WorkingMemory: 1620,
      CognitiveFlexibility: 1580,
      InhibitoryControl: 1640,
      SustainedAttention: 1590,
      ProcessingSpeed: 1610
    };
  }
}

export const syncManager = new SyncManager();
