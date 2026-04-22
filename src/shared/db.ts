// ============================================================
// NeuroSustain — Dexie.js Database Schema
// Local-first IndexedDB persistence layer
// ============================================================

import Dexie from 'dexie';
import type { Trial, Session, PillarRating, FsrsCard, UserProfile, CognitiveSnapshot } from './types.ts';
import { ALL_PILLARS, GLICKO2_DEFAULTS } from './constants.ts';

class NeuroSustainDB extends Dexie {
  trials!: Dexie.Table<Trial, number>;
  sessions!: Dexie.Table<Session, number>;
  ratings!: Dexie.Table<PillarRating, string>;
  fsrsCards!: Dexie.Table<FsrsCard, number>;
  profile!: Dexie.Table<UserProfile, number>;
  snapshots!: Dexie.Table<CognitiveSnapshot, number>;

  constructor() {
    super('NeuroSustainDB');

    this.version(1).stores({
      trials: '++id, sessionId, exerciseType, pillar, timestamp',
      sessions: '++id, sessionId, startedAt, pillar, exerciseType',
      ratings: 'pillar, lastUpdated',
      fsrsCards: '++id, [exerciseType+pillar], nextReviewDate',
      profile: '++id, createdAt',
      snapshots: '++id, weekStart, [pillar+weekStart]',
    });
  }
}

export const db = new NeuroSustainDB();

/** Initialize default profile and ratings if first launch */
export async function initialize_db(): Promise<void> {
  const profileCount = await db.profile.count();
  if (profileCount === 0) {
    await db.profile.add({
      createdAt: Date.now(),
      locale: (navigator.language.startsWith('es') ? 'es' : 'en'),
      totalSessions: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastSessionDate: '',
    });
  }

  const ratingsCount = await db.ratings.count();
  if (ratingsCount === 0) {
    const defaultRatings: PillarRating[] = ALL_PILLARS.map(pillar => ({
      pillar,
      rating: GLICKO2_DEFAULTS.INITIAL_RATING,
      rd: GLICKO2_DEFAULTS.INITIAL_RD,
      volatility: GLICKO2_DEFAULTS.INITIAL_VOLATILITY,
      lastUpdated: Date.now(),
    }));
    await db.ratings.bulkAdd(defaultRatings);
  }
}

/** Save a completed session's trials and summary */
export async function save_session(session: Session, trials: Trial[]): Promise<void> {
  await db.transaction('rw', [db.sessions, db.trials, db.profile], async () => {
    await db.sessions.add(session);
    await db.trials.bulkAdd(trials);

    const profile = await db.profile.toCollection().first();
    if (profile?.id != null) {
      const today = new Date().toISOString().slice(0, 10);
      const isConsecutiveDay = profile.lastSessionDate === new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const isSameDay = profile.lastSessionDate === today;

      let newStreak = profile.currentStreak;
      if (isConsecutiveDay) {
        newStreak += 1;
      } else if (!isSameDay) {
        newStreak = 1;
      }

      await db.profile.update(profile.id, {
        totalSessions: profile.totalSessions + 1,
        currentStreak: newStreak,
        longestStreak: Math.max(profile.longestStreak, newStreak),
        lastSessionDate: today,
      });
    }
  });
}

/** Get the user profile */
export async function get_profile(): Promise<UserProfile | undefined> {
  return db.profile.toCollection().first();
}

/** Get all pillar ratings */
export async function get_ratings(): Promise<PillarRating[]> {
  return db.ratings.toArray();
}

/** Get recent sessions (last N) */
export async function get_recent_sessions(count: number): Promise<Session[]> {
  return db.sessions.orderBy('startedAt').reverse().limit(count).toArray();
}
