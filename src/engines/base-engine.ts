// ============================================================
// NeuroSustain — Base Engine
// Abstract Canvas lifecycle for all cognitive exercises
// Provides: init → update → render → cleanup loop
//
// Sprint 3 additions:
//   - SessionConfig (difficulty, inputMode)
//   - Audio feedback integration
//   - [Esc] Abort button (frosted-glass pill, top-right)
//   - EMA Fatigue Tracking (System B)
// ============================================================

import type { Trial, ExerciseType, CognitivePillar, EngineCallbacks, TrialResults, FatigueEvent, SessionConfig } from '@shared/types.ts';
import { compute_mean, compute_sd, compute_cv, compute_accuracy, compute_focus_score, filter_valid_rts, compute_ema_step, init_ema, detect_ema_fatigue, EMA_BASELINE_TRIALS } from '@core/analytics/analytics.ts';
import { precise_now } from '@shared/utils.ts';
import { TIMING } from '@shared/constants.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

export type EngineState = 'idle' | 'running' | 'paused' | 'complete';

/** Default session config if none provided */
const DEFAULT_CONFIG: SessionConfig = {
  difficulty: 1,
  inputMode: 'auto',
  neuralStorm: false,
};

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
  protected config: SessionConfig = DEFAULT_CONFIG;

  // ── System B: EMA Fatigue Tracking ──
  private _ema: number = 0;
  private _ema_baseline: number = 0;
  private _ema_correct_count: number = 0;
  private _fatigue_fired: boolean = false;

  private _animFrameId: number = 0;
  private _lastTimestamp: number = 0;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _resizeHandler: (() => void) | null = null;
  private _clickHandler: ((e: PointerEvent) => void) | null = null;

  // ── Exit button geometry (computed on resize) ──
  private _exitBtnX: number = 0;
  private _exitBtnY: number = 8;
  private _exitBtnW: number = 110;
  private _exitBtnH: number = 32;

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

  /** Start the exercise session with optional configuration */
  start(config?: Partial<SessionConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = 'running';
    this.trials = [];
    this.currentTrial = 0;
    this._ema = 0;
    this._ema_baseline = 0;
    this._ema_correct_count = 0;
    this._fatigue_fired = false;

    this._resize_canvas();

    // Unlock audio on first user interaction
    audioEngine.unlock();

    // Input handlers
    this._keyHandler = (e: KeyboardEvent) => this._on_key(e);
    this._resizeHandler = () => this._resize_canvas();
    this._clickHandler = (e: PointerEvent) => this._on_exit_click(e);
    window.addEventListener('keydown', this._keyHandler);
    window.addEventListener('resize', this._resizeHandler);
    this.canvas.addEventListener('pointerdown', this._clickHandler);

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
    if (this._clickHandler) this.canvas.removeEventListener('pointerdown', this._clickHandler);

    this.on_cleanup();
  }

  /** Record a completed trial with audio feedback and EMA tracking */
  protected record_trial(trial: Omit<Trial, 'id' | 'sessionId'>): void {
    this.trials.push(trial);
    this.currentTrial++;
    this.callbacks.onTrialComplete(trial);

    // ── Audio feedback ──
    if (trial.isCorrect) {
      audioEngine.play_correct();
    } else {
      audioEngine.play_error();
    }

    // ── EMA update on valid correct trials only ──
    if (trial.isCorrect && trial.reactionTimeMs >= TIMING.MIN_REACTION_MS && trial.reactionTimeMs <= TIMING.MAX_REACTION_MS) {
      this._ema_correct_count++;

      if (this._ema_correct_count === 1) {
        this._ema = init_ema(trial.reactionTimeMs);
      } else {
        this._ema = compute_ema_step(this._ema, trial.reactionTimeMs);
      }

      // Lock in baseline after warm-up window
      if (this._ema_correct_count === EMA_BASELINE_TRIALS) {
        this._ema_baseline = this._ema;
      }

      // Check for fatigue after baseline is established
      if (
        this._ema_baseline > 0 &&
        !this._fatigue_fired &&
        detect_ema_fatigue(this._ema_baseline, this._ema)
      ) {
        this._fatigue_fired = true;
        const risePercent = ((this._ema - this._ema_baseline) / this._ema_baseline) * 100;
        const event: FatigueEvent = {
          trialNumber:    this.currentTrial,
          baselineEmaMs:  Math.round(this._ema_baseline),
          currentEmaMs:   Math.round(this._ema),
          risePercent:    Math.round(risePercent),
        };
        this.callbacks.onFatigueDetected?.(event);
      }
    }

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

    // Recalculate exit button position
    this._exitBtnW = 110;
    this._exitBtnH = 32;
    this._exitBtnX = this.width - this._exitBtnW - 12;
    this._exitBtnY = 8;
  }

  /** Main render loop */
  private _loop(): void {
    if (this.state !== 'running') return;

    const now = precise_now();
    const dt = now - this._lastTimestamp;
    this._lastTimestamp = now;

    this.on_update(dt);
    this.on_render(this.ctx);

    // Draw exit button LAST (on top of everything)
    this._render_exit_button(this.ctx);

    this._animFrameId = requestAnimationFrame(() => this._loop());
  }

  /** Key event dispatcher — includes Escape for abort */
  private _on_key(e: KeyboardEvent): void {
    if (this.state !== 'running') return;

    if (e.code === 'Escape') {
      e.preventDefault();
      this._abort_session();
      return;
    }

    e.preventDefault();
    this.on_key_down(e.code, precise_now());
  }

  /** Handle clicks on the exit button */
  private _on_exit_click(e: PointerEvent): void {
    if (this.state !== 'running') return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (
      x >= this._exitBtnX && x <= this._exitBtnX + this._exitBtnW &&
      y >= this._exitBtnY && y <= this._exitBtnY + this._exitBtnH
    ) {
      e.stopPropagation();
      this._abort_session();
    }
  }

  /** Clean abort — no data saved, no FSRS impact, no streak penalty */
  private _abort_session(): void {
    this.stop();
    this.callbacks.onExit();
  }

  /**
   * Render the frosted-glass [Esc] Abort pill at top-right.
   * Drawn by the base engine so every exercise gets it for free.
   */
  private _render_exit_button(ctx: CanvasRenderingContext2D): void {
    const x = this._exitBtnX;
    const y = this._exitBtnY;
    const w = this._exitBtnW;
    const h = this._exitBtnH;
    const r = h / 2;

    ctx.save();

    // Background pill
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = 'hsla(225, 30%, 15%, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(220, 20%, 40%, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.font = '500 12px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Esc  Abort', x + w / 2, y + h / 2);

    ctx.restore();
  }

  // ── Abstract lifecycle methods ──
  protected abstract on_start(): void;
  protected abstract on_update(dt: number): void;
  protected abstract on_render(ctx: CanvasRenderingContext2D): void;
  protected abstract on_key_down(code: string, timestamp: number): void;
  protected abstract on_cleanup(): void;
}
