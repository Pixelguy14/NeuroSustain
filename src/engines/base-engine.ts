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
import { compute_mean, compute_sd, compute_cv, compute_accuracy, compute_focus_score, compute_ema_step, init_ema, detect_ema_fatigue, EMA_BASELINE_TRIALS } from '@core/analytics/analytics.ts';
import { clean_reaction_time, compute_difficulty_weighted_rt } from '@core/input/latency-normalizer.ts';
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

  // ── System D: Adaptive Staircase (Intra-Session Difficulty) ──
  protected _currentDifficulty: number = 1;
  private _consecutiveCorrect: number = 0;

  private _animFrameId: number = 0;
  private _lastTimestamp: number = 0;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _resizeHandler: (() => void) | null = null;
  private _clickHandler: ((e: PointerEvent) => void) | null = null;

  // ── Cinematic Polish State ──────────────────────────────
  protected _feedbackFlash: { color: string, opacity: number, size: number, maxRadius: number } | null = null;
  protected _countdownValue: number | null = null;
  protected _countdownTimer: number = 0;
  protected _countdownScale: number = 1;
  protected _countdownOpacity: number = 0;
  private _countdownCallback: (() => void) | null = null;

  // ── Exit button geometry (computed on resize) ──
  private _exitBtnX: number = 0;
  private _exitBtnY: number = 8;
  private _exitBtnW: number = 110;
  private _exitBtnH: number = 32;

  abstract readonly exerciseType: ExerciseType;
  abstract readonly primaryPillar: CognitivePillar;
  abstract readonly totalTrials: number;
  protected validReactionTimeMax: number = TIMING.MAX_REACTION_MS;

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
    this._currentDifficulty = this.config.difficulty;
    this.state = 'running';
    this.trials = [];
    this.currentTrial = 0;
    this._ema = 0;
    this._ema_baseline = 0;
    this._ema_correct_count = 0;
    this._fatigue_fired = false;

    // ── Refined Warm-up: Start sessions below baseline to allow calibration ──
    const baseline = this.config.difficulty;
    let offset = 1;
    if (baseline >= 9) offset = 3;
    else if (baseline >= 6) offset = 2;

    this._currentDifficulty = config?.sessionDifficulty ?? Math.max(1, baseline - offset);
    this._consecutiveCorrect = 0;

    this._resize_canvas();

    // Unlock audio on first user interaction and start ambience
    audioEngine.unlock();
    audioEngine.start_ambience();
    audioEngine.duckAmbience(); // Duck during countdown

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
    
    audioEngine.duckAmbience();
    audioEngine.stop_all_session_audio();
    this.on_cleanup();
  }

  /** Record a completed trial with audio feedback and EMA tracking */
  protected record_trial(trial: Omit<Trial, 'id' | 'sessionId'>): void {
    
    // Asynchronous normalization — we use an IIFE to not block the current frame
    (async () => {
      trial.isNeuralStorm = this.config.neuralStorm;
      const cleanRT = await clean_reaction_time(trial.reactionTimeMs);
      trial.difficultyWeightedRT = compute_difficulty_weighted_rt(cleanRT, trial.difficulty);

      this.trials.push(trial);
      this.currentTrial++;
      this.callbacks.onTrialComplete(trial);

      // ── Audio & Visual feedback ──
      this.trigger_feedback_flash(trial.isCorrect);
      if (trial.isCorrect) {
        audioEngine.play_correct();
      } else {
        audioEngine.play_error();
      }

      // ── EMA update on valid correct trials only (Isolate Neural Storm) ──
      if (!this.config.neuralStorm && trial.isCorrect && trial.reactionTimeMs >= TIMING.MIN_REACTION_MS && trial.reactionTimeMs <= this.validReactionTimeMax) {
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

      // ── Adaptive Staircase: Inverse Laddering ──
      if (!this.config.neuralStorm) {
        if (trial.isCorrect) {
          this._consecutiveCorrect++;
          
          // Climb faster (2-Up) if still below baseline; standard (3-Up) otherwise
          const threshold = this._currentDifficulty < this.config.difficulty ? 2 : 3;
          
          if (this._consecutiveCorrect >= threshold) {
            this._currentDifficulty = Math.min(10, this._currentDifficulty + 1);
            this._consecutiveCorrect = 0;
          }
        } else {
          this._consecutiveCorrect = 0;
          this._currentDifficulty = Math.max(1, this._currentDifficulty - 1);
        }
      }

      if (this.currentTrial >= this.totalTrials) {
        this._complete_session();
      }
    })();
  }

  /** Aggregate results and notify completion */
  private _complete_session(): void {
    this.state = 'complete';
    cancelAnimationFrame(this._animFrameId);

    let validRTs: number[] = [];
    let correctCount = 0;
    
    for (let i = 0; i < this.trials.length; i++) {
      const t = this.trials[i]!;
      if (t.isCorrect) {
        correctCount++;
        if (t.reactionTimeMs >= TIMING.MIN_REACTION_MS && t.reactionTimeMs <= this.validReactionTimeMax) {
          validRTs.push(t.reactionTimeMs);
        }
      }
    }

    const accuracy = compute_accuracy(correctCount, this.trials.length);
    const meanRT = compute_mean(validRTs);
    const sdRT = compute_sd(validRTs);
    const cv = compute_cv(validRTs);
    const focusScore = compute_focus_score(accuracy, cv);

    const difficultyHistory: number[] = [];
    for (let i = 0; i < this.trials.length; i++) {
      difficultyHistory.push(this.trials[i]!.difficulty);
    }
    const meanDifficulty = compute_mean(difficultyHistory);

    const results: TrialResults = {
      trials: this.trials,
      accuracy,
      meanReactionTimeMs: meanRT,
      sdReactionTimeMs: sdRT,
      cvReactionTime: cv,
      focusScore,
      meanDifficulty,
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

    // Recalculate exit button position (Responsive: Bottom-Right on mobile, Top-Right on Desktop)
    const isMobile = this.width < 768;
    this._exitBtnW = 100;
    this._exitBtnH = 34;
    
    if (isMobile) {
      this._exitBtnX = 12;
      this._exitBtnY = 8;
    } else {
      this._exitBtnX = this.width - this._exitBtnW - 12;
      this._exitBtnY = 8;
    }
  }

  /** Main render loop */
  private _loop(): void {
    if (this.state !== 'running') return;

    const now = precise_now();
    const dt = now - this._lastTimestamp;
    this._lastTimestamp = now;

    this.on_update(dt);
    this.on_render(this.ctx);
    this.render_cinematic_countdown(this.ctx, dt);
    this.render_feedback_overlay(this.ctx, dt);

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
    this.on_key_event(e, precise_now());
  }

  /**
   * Override this if you need access to the full KeyboardEvent (e.g. e.key for i18n input)
   * By default, it delegates to on_key_down(e.code) for backward compatibility.
   */
  protected on_key_event(e: KeyboardEvent, timestamp: number): void {
    this.on_key_down(e.code, timestamp);
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

    // Breathing effect (Organic Pillar)
    const breathe = 0.7 + Math.sin(precise_now() * 0.002) * 0.3;

    ctx.save();
    ctx.globalAlpha = breathe;

    // Background pill
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = 'hsla(225, 30%, 15%, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(175, 70%, 50%, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 85%, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ESC  ABORT', x + w / 2, y + h / 2);

    ctx.restore();
  }

  /**
   * Pillar 2: Feedback Flash (Radial Gradient)
   * Expanding and fading circle from center.
   */
  protected trigger_feedback_flash(isCorrect: boolean): void {
    this._feedbackFlash = {
      color: isCorrect ? 'hsla(145, 65%, 48%, 0.4)' : 'hsla(0, 75%, 55%, 0.4)',
      opacity: 1,
      size: 0,
      maxRadius: Math.min(this.width, this.height) * 0.4
    };
    this.haptic_feedback(isCorrect);
  }

  /**
   * Pillar 3: Haptic Feedback Wrapper
   */
  protected haptic_feedback(isSuccess: boolean): void {
    if (!navigator.vibrate) return;
    if (isSuccess) {
      navigator.vibrate([20, 30, 20]); // Double tap
    } else {
      navigator.vibrate([50]); // Solid thud
    }
  }

  /**
   * Pillar 2: Heartbeat Countdown
   * Animates scale and opacity for 3, 2, 1, GO!
   */
  protected render_cinematic_countdown(ctx: CanvasRenderingContext2D, dt: number): void {
    if (this._countdownValue === null) return;

    this._countdownTimer += dt;
    
    // Auto-advance logic (1 second per value)
    if (this._countdownTimer >= 1000) {
      this._countdownValue--;
      this._countdownTimer = 0;
      
      if (this._countdownValue > 0) {
        audioEngine.play_tick(false);
      } else if (this._countdownValue === 0) {
        audioEngine.play_tick(true);
      } else {
        // Countdown finished
        const cb = this._countdownCallback;
        this._countdownValue = null;
        this._countdownCallback = null;
        cb?.();
        return;
      }
    }

    // Heartbeat LERP (first 300ms of each second)
    const animProgress = Math.min(1, this._countdownTimer / 300);
    this._countdownScale = 1.5 - (0.5 * animProgress);
    this._countdownOpacity = animProgress;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${80 * this._countdownScale}px Inter, sans-serif`;
    ctx.fillStyle = `rgba(255, 255, 255, ${this._countdownOpacity * 0.35})`;
    
    const text = this._countdownValue === 0 ? 'GO!' : this._countdownValue.toString();
    ctx.fillText(text, this.width / 2, this.height / 2);
    ctx.restore();
  }

  /** Render the expanding feedback ring */
  protected render_feedback_overlay(ctx: CanvasRenderingContext2D, dt: number): void {
    if (!this._feedbackFlash) return;

    this._feedbackFlash.size += (this._feedbackFlash.maxRadius - this._feedbackFlash.size) * 0.1;
    this._feedbackFlash.opacity -= dt / 400;

    if (this._feedbackFlash.opacity <= 0) {
      this._feedbackFlash = null;
      return;
    }

    ctx.save();
    const grad = ctx.createRadialGradient(
      this.width / 2, this.height / 2, 0,
      this.width / 2, this.height / 2, this._feedbackFlash.size
    );
    grad.addColorStop(0, this._feedbackFlash.color.replace('0.4', (this._feedbackFlash.opacity * 0.3).toString()));
    grad.addColorStop(1, 'transparent');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  /**
   * Start the standardized clinical countdown (3, 2, 1, GO)
   */
  protected start_countdown(onComplete: () => void): void {
    this._countdownValue = 3;
    this._countdownTimer = 0;
    this._countdownCallback = onComplete;
    audioEngine.play_tick(false);
  }

  // ── Abstract lifecycle methods ──
  protected abstract on_start(): void;
  protected abstract on_update(dt: number): void;
  protected abstract on_render(ctx: CanvasRenderingContext2D): void;
  protected abstract on_key_down(code: string, timestamp: number): void;
  protected abstract on_cleanup(): void;
}
