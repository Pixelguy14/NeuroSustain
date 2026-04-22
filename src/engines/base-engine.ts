// ============================================================
// NeuroSustain — Base Engine
// Abstract Canvas lifecycle for all cognitive exercises
// Provides: init → update → render → cleanup loop
// ============================================================

import type { Trial, ExerciseType, CognitivePillar, EngineCallbacks, TrialResults } from '@shared/types.ts';
import { compute_mean, compute_sd, compute_cv, compute_accuracy, compute_focus_score, filter_valid_rts } from '@core/analytics/analytics.ts';
import { precise_now } from '@shared/utils.ts';

export type EngineState = 'idle' | 'running' | 'paused' | 'complete';

export abstract class BaseEngine {
  protected canvas: HTMLCanvasElement;
  protected ctx: CanvasRenderingContext2D;
  protected width: number = 0;
  protected height: number = 0;
  protected dpr: number = 1;

  protected state: EngineState = 'idle';
  protected trials: Omit<Trial, 'id' | 'sessionId'>[] = [];
  protected currentTrial: number = 0;
  protected callbacks: EngineCallbacks;

  private _animFrameId: number = 0;
  private _lastTimestamp: number = 0;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _resizeHandler: (() => void) | null = null;

  abstract readonly exerciseType: ExerciseType;
  abstract readonly primaryPillar: CognitivePillar;
  abstract readonly totalTrials: number;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.dpr = window.devicePixelRatio || 1;
  }

  /** Start the exercise session */
  start(): void {
    this.state = 'running';
    this.trials = [];
    this.currentTrial = 0;

    this._resize_canvas();

    // Input handlers
    this._keyHandler = (e: KeyboardEvent) => this._on_key(e);
    this._resizeHandler = () => this._resize_canvas();
    window.addEventListener('keydown', this._keyHandler);
    window.addEventListener('resize', this._resizeHandler);

    this.on_start();
    this._lastTimestamp = precise_now();
    this._loop();
  }

  /** Stop and clean up */
  stop(): void {
    this.state = 'idle';
    cancelAnimationFrame(this._animFrameId);

    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);

    this.on_cleanup();
  }

  /** Record a completed trial */
  protected record_trial(trial: Omit<Trial, 'id' | 'sessionId'>): void {
    this.trials.push(trial);
    this.currentTrial++;
    this.callbacks.onTrialComplete(trial);

    if (this.currentTrial >= this.totalTrials) {
      this._complete_session();
    }
  }

  /** Aggregate results and notify completion */
  private _complete_session(): void {
    this.state = 'complete';
    cancelAnimationFrame(this._animFrameId);

    const validRTs = filter_valid_rts(
      this.trials.filter(t => t.isCorrect).map(t => t.reactionTimeMs)
    );
    const correctCount = this.trials.filter(t => t.isCorrect).length;

    const accuracy = compute_accuracy(correctCount, this.trials.length);
    const meanRT = compute_mean(validRTs);
    const sdRT = compute_sd(validRTs);
    const cv = compute_cv(validRTs);
    const focusScore = compute_focus_score(accuracy, cv);

    const results: TrialResults = {
      trials: this.trials,
      accuracy,
      meanReactionTimeMs: meanRT,
      sdReactionTimeMs: sdRT,
      cvReactionTime: cv,
      focusScore,
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
    };

    this.callbacks.onSessionComplete(results);
  }

  /** Resize canvas to fill container */
  private _resize_canvas(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    this.width = parent.clientWidth;
    this.height = parent.clientHeight;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Main render loop */
  private _loop(): void {
    if (this.state !== 'running') return;

    const now = precise_now();
    const dt = now - this._lastTimestamp;
    this._lastTimestamp = now;

    this.on_update(dt);
    this.on_render(this.ctx);

    this._animFrameId = requestAnimationFrame(() => this._loop());
  }

  /** Key event dispatcher */
  private _on_key(e: KeyboardEvent): void {
    if (this.state !== 'running') return;
    e.preventDefault();
    this.on_key_down(e.code, precise_now());
  }

  // ── Abstract lifecycle methods ──
  protected abstract on_start(): void;
  protected abstract on_update(dt: number): void;
  protected abstract on_render(ctx: CanvasRenderingContext2D): void;
  protected abstract on_key_down(code: string, timestamp: number): void;
  protected abstract on_cleanup(): void;
}
