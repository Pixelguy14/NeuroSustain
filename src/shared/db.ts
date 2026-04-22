// ============================================================
// NeuroSustain — Dexie.js Database Schema
// Local-first IndexedDB persistence layer
// ============================================================

import Dexie from 'dexie';
import type { Trial, Session, PillarRating, FsrsCard, UserProfile, CognitiveSnapshot, HardwareProfile, FsrsJournalEntry } from './types.ts';
import { ALL_PILLARS, GLICKO2_DEFAULTS } from './constants.ts';

class NeuroSustainDB extends Dexie {
  trials!: Dexie.Table<Trial, number>;
  sessions!: Dexie.Table<Session, number>;
  ratings!: Dexie.Table<PillarRating, string>;
  fsrsCards!: Dexie.Table<FsrsCard, number>;
  profile!: Dexie.Table<UserProfile, number>;
  snapshots!: Dexie.Table<CognitiveSnapshot, number>;
  hardwareProfiles!: Dexie.Table<HardwareProfile, number>;
  fsrsJournal!: Dexie.Table<FsrsJournalEntry, number>;

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

    // v2: Hardware calibration + FSRS crash-recovery journal
    this.version(2).stores({
      trials: '++id, sessionId, exerciseType, pillar, timestamp',
      sessions: '++id, sessionId, startedAt, pillar, exerciseType',
      ratings: 'pillar, lastUpdated',
      fsrsCards: '++id, [exerciseType+pillar], nextReviewDate',
      profile: '++id, createdAt',
      snapshots: '++id, weekStart, [pillar+weekStart]',
      hardwareProfiles: '++id, measuredAt',
      fsrsJournal: '++id, status, createdAt, exerciseType',
    });

    // v3: Profile audio focus ambience preference
    this.version(3).stores({
      profile: '++id, createdAt', // Schema unchanged
    }).upgrade(tx => {
      return tx.table('profile').toCollection().modify(profile => {
        if (profile.audioFocusAmbience === undefined) {
          profile.audioFocusAmbience = false;
        }
      });
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
      audioFocusAmbience: false,
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

// ── System A: Hardware Profile ──────────────────────────────

/** Get the stored hardware calibration profile (null if never calibrated) */
export async function get_hardware_profile(): Promise<HardwareProfile | undefined> {
  return db.hardwareProfiles.orderBy('measuredAt').last();
}

/** Save a hardware calibration result */
export async function save_hardware_profile(profile: HardwareProfile): Promise<void> {
  await db.hardwareProfiles.add(profile);
}

// ── System C: FSRS Journal Recovery ────────────────────────

/**
 * On boot, find any journal entries stuck in 'pending' for > 30 seconds.
 * These represent FSRS recalibrations that were interrupted by a tab close
 * or crash. Re-queues them through the bridge.
 *
 * Call this from app.ts after the DB is initialized.
 */
export async function recover_orphaned_journals(): Promise<number> {
  const STALE_THRESHOLD_MS = 30_000;
  const cutoff = Date.now() - STALE_THRESHOLD_MS;

  const orphans = await db.fsrsJournal
    .where('status')
    .equals('pending')
    .and(entry => entry.createdAt < cutoff)
    .toArray();

  if (orphans.length === 0) return 0;

  console.warn(`[Recovery] Found ${orphans.length} orphaned FSRS journal entries — re-queuing.`);

  // Import bridge lazily to avoid circular dependency at module load time
  const { fsrsBridge } = await import('../core/fsrs/fsrs-bridge.ts');

  for (const entry of orphans) {
    try {
      // Mark as failed first so a second crash doesn't re-process it
      await db.fsrsJournal.update(entry.id!, { status: 'failed', completedAt: Date.now() });

      // Re-run recalibration with the stored session metrics
      await fsrsBridge.recalibrate_after_session(
        entry.exerciseType,
        entry.pillar,
        entry.accuracy,
        entry.focusScore,
        entry.cvReactionTime,
        [] // No raw trials available post-crash — FSRS only needs the aggregates
      );

      console.info(`[Recovery] Re-processed: ${entry.exerciseType} (${entry.pillar})`);
    } catch (err) {
      console.error(`[Recovery] Failed to re-process journal ${entry.id}:`, err);
    }
  }

  return orphans.length;
}

// ── System D: Analytics & Portability ──────────────────────

export interface DailyAggregate {
  date: string;
  meanFocusScore: number;
  meanAccuracy: number;
  meanRT: number;
  sdRT: number;
  sessionCount: number;
}

/** Get sessions history grouped by day for the last N days */
export async function get_sessions_history(days: number): Promise<DailyAggregate[]> {
  const cutoff = Date.now() - (days * 86400000);
  const sessions = await db.sessions.where('startedAt').aboveOrEqual(cutoff).toArray();
  
  const grouped = new Map<string, Session[]>();
  for (const s of sessions) {
    const date = new Date(s.startedAt).toISOString().slice(0, 10);
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(s);
  }

  const result: DailyAggregate[] = [];
  // Sort dates chronologically
  const sortedDates = Array.from(grouped.keys()).sort();
  
  for (const date of sortedDates) {
    const daySessions = grouped.get(date)!;
    const sessionCount = daySessions.length;
    let sumFocus = 0, sumAcc = 0, sumRT = 0;
    
    for (const s of daySessions) {
      sumFocus += s.focusScore;
      sumAcc += s.accuracy;
      sumRT += s.meanReactionTimeMs;
    }
    
    const meanRT = sumRT / sessionCount;
    // Compute SD of RT across sessions for this day
    let sumSq = 0;
    for (const s of daySessions) {
      sumSq += Math.pow(s.meanReactionTimeMs - meanRT, 2);
    }
    const sdRT = sessionCount > 1 ? Math.sqrt(sumSq / (sessionCount - 1)) : 0;

    result.push({
      date,
      meanFocusScore: sumFocus / sessionCount,
      meanAccuracy: sumAcc / sessionCount,
      meanRT,
      sdRT,
      sessionCount
    });
  }
  
  return result;
}

export async function export_data_json(): Promise<string> {
  const data = {
    profile: await db.profile.toArray(),
    ratings: await db.ratings.toArray(),
    fsrsCards: await db.fsrsCards.toArray(),
    sessions: await db.sessions.toArray(),
    trials: await db.trials.toArray(),
  };
  return JSON.stringify(data, null, 2);
}

export async function export_data_csv(): Promise<string> {
  const sessions = await db.sessions.toArray();
  if (sessions.length === 0) return "sessionId,startedAt,exerciseType,pillar,accuracy,meanReactionTimeMs,focusScore\n";
  
  let csv = "sessionId,startedAt,exerciseType,pillar,accuracy,meanReactionTimeMs,focusScore\n";
  for (const s of sessions) {
    const dateStr = new Date(s.startedAt).toISOString();
    csv += `${s.sessionId},${dateStr},${s.exerciseType},${s.pillar},${s.accuracy},${s.meanReactionTimeMs},${s.focusScore}\n`;
  }
  return csv;
}

export async function import_data_json(json: string): Promise<void> {
  const data = JSON.parse(json);
  
  await db.transaction('rw', [db.profile, db.ratings, db.fsrsCards, db.sessions, db.trials], async () => {
    if (data.profile?.length) {
      await db.profile.clear();
      await db.profile.bulkAdd(data.profile);
    }
    if (data.ratings?.length) {
      await db.ratings.clear();
      await db.ratings.bulkAdd(data.ratings);
    }
    if (data.fsrsCards?.length) {
      await db.fsrsCards.clear();
      await db.fsrsCards.bulkAdd(data.fsrsCards);
    }
    if (data.sessions?.length) {
      await db.sessions.clear();
      await db.sessions.bulkAdd(data.sessions);
    }
    if (data.trials?.length) {
      await db.trials.clear();
      await db.trials.bulkAdd(data.trials);
    }
  });
}

