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

import type { Trial, ExerciseType, CognitivePillar, EngineCallbacks, TrialResults, FatigueEvent, SessionConfig, HardwareProfile } from '@shared/types.ts';
import { compute_mean, compute_sd, compute_cv, compute_accuracy, compute_focus_score, compute_ema_step, init_ema, detect_ema_fatigue, EMA_BASELINE_TRIALS } from '@core/analytics/analytics.ts';
import { clean_reaction_time_sync, compute_difficulty_weighted_rt } from '@core/input/latency-normalizer.ts';
import { precise_now } from '@shared/utils.ts';
import { TIMING } from '@shared/constants.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import { get_hardware_profile } from '@shared/db.ts';
import { t } from '@shared/i18n.ts';

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
  private _pendingFatigueEvent: FatigueEvent | null = null;

  // ── System D: Adaptive Staircase (Intra-Session Difficulty) ──
  protected _currentDifficulty: number = 1;
  private _consecutiveCorrect: number = 0;

  private _animFrameId: number = 0;
  private _lastTimestamp: number = 0;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _clickHandler: ((e: PointerEvent) => void) | null = null;
  private _boundLoop: () => void;
  private _hardwareProfile: HardwareProfile | null = null;
  private _exitLabel: string = '';
  protected lastOrbRadius: number = 120;

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
    this._boundLoop = () => this._loop();
  }

  /** Start the exercise session with optional configuration */
  async start(config?: Partial<SessionConfig>): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._currentDifficulty = this.config.difficulty;
    this.state = 'running';
    this.trials = [];
    this.currentTrial = 0;
    this._ema = 0;
    this._ema_baseline = 0;
    this._ema_correct_count = 0;
    this._fatigue_fired = false;
    this._pendingFatigueEvent = null;

    // Pre-cache hardware profile once (eliminates per-trial IndexedDB reads)
    this._hardwareProfile = await get_hardware_profile() ?? null;
    this._exitLabel = t('session.abort');

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
    this._clickHandler = (e: PointerEvent) => this._on_exit_click(e);
    window.addEventListener('keydown', this._keyHandler);
    this.canvas.addEventListener('pointerdown', this._clickHandler);

    // Use ResizeObserver instead of window.resize to avoid mobile URL-bar thrashing
    this._resizeObserver = new ResizeObserver(() => this._resize_canvas());
    const parent = this.canvas.parentElement;
    if (parent) this._resizeObserver.observe(parent);

    this.on_start();
    this._lastTimestamp = precise_now();
    this._loop();
  }

  /** Stop and clean up */
  stop(): void {
    this.state = 'idle';
    cancelAnimationFrame(this._animFrameId);

    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._clickHandler) this.canvas.removeEventListener('pointerdown', this._clickHandler);
    
    audioEngine.duckAmbience();
    audioEngine.stop_all_session_audio();
    this.on_cleanup();
  }

  /** Record a completed trial with audio feedback and EMA tracking (fully synchronous hot-path) */
  protected record_trial(trial: Omit<Trial, 'id' | 'sessionId'>): void {
    trial.isNeuralStorm = this.config.neuralStorm;
    const cleanRT = clean_reaction_time_sync(trial.reactionTimeMs, this._hardwareProfile);
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
        this._pendingFatigueEvent = {
          trialNumber:    this.currentTrial,
          baselineEmaMs:  Math.round(this._ema_baseline),
          currentEmaMs:   Math.round(this._ema),
          risePercent:    Math.round(risePercent),
        };
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

    // Trigger delayed fatigue warning if detected during the session
    if (this._pendingFatigueEvent) {
      this.callbacks.onFatigueDetected?.(this._pendingFatigueEvent);
      this._pendingFatigueEvent = null;
    }

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

    // Recalculate exit button position (Top-center, above HUD badges)
    this._exitBtnW = 90;
    this._exitBtnH = 28;
    this._exitBtnX = (this.width - this._exitBtnW) / 2;
    this._exitBtnY = 6;
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

    this._animFrameId = requestAnimationFrame(this._boundLoop);
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
    ctx.font = '800 9px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 85%, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._exitLabel.toUpperCase(), x + w / 2, y + h / 2);

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
    ctx.font = `bold ${80 * this._countdownScale}px Outfit, sans-serif`;
    ctx.fillStyle = `rgba(255, 255, 255, ${this._countdownOpacity * 0.35})`;
    
    const text = this._countdownValue === 0 ? 'GO!' : this._countdownValue.toString();
    ctx.fillText(text, this.width / 2, this.height / 2);
    ctx.restore();
  }

  /** Render the expanding feedback ring (zero-allocation: arc + globalAlpha instead of createRadialGradient) */
  protected render_feedback_overlay(ctx: CanvasRenderingContext2D, dt: number): void {
    if (!this._feedbackFlash) return;

    this._feedbackFlash.size += (this._feedbackFlash.maxRadius - this._feedbackFlash.size) * 0.1;
    this._feedbackFlash.opacity -= dt / 400;

    if (this._feedbackFlash.opacity <= 0) {
      this._feedbackFlash = null;
      return;
    }

    ctx.save();
    ctx.globalAlpha = this._feedbackFlash.opacity * 0.3;
    ctx.beginPath();
    ctx.arc(this.width / 2, this.height / 2, this._feedbackFlash.size, 0, Math.PI * 2);
    ctx.fillStyle = this._feedbackFlash.color;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Start the standardized clinical countdown (3, 2, 1, GO)
   */
  /**
   * ── Rich Aesthetics Toolkit ──
   * Standardized premium UI components for all engines
   */

  /** Draw a glassmorphism panel */
  protected draw_glass_panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number = 16): void {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = 'hsla(225, 30%, 15%, 0.4)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(175, 70%, 50%, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** Draw a tactile button with state feedback and auto-scaling text */
  protected draw_tactile_button(
    ctx: CanvasRenderingContext2D, 
    x: number, y: number, w: number, h: number, 
    label: string, 
    style: { bg: string, stroke: string, text: string },
    isPressed: boolean = false
  ): void {
    const scale = isPressed ? 0.95 : 1.0;
    
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(scale, scale);
    
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 8);
    ctx.fillStyle = style.bg;
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Auto-scale font if label is too long
    let fontSize = 14;
    ctx.font = `bold ${fontSize}px Outfit, sans-serif`;
    const metrics = ctx.measureText(label);
    if (metrics.width > w - 12) {
      fontSize = Math.floor(fontSize * (w - 12) / metrics.width);
      ctx.font = `bold ${fontSize}px Outfit, sans-serif`;
    }

    ctx.fillStyle = style.text;
    ctx.fillText(label, 0, 0);
    
    ctx.restore();
  }

  /** Draw a high-impact feedback orb (Success/Failure) */
  protected draw_feedback_orb(ctx: CanvasRenderingContext2D, x: number, y: number, isCorrect: boolean, progress: number): void {
    const scale = 0.8 + Math.exp(-progress * 5) * 0.4;
    const opacity = Math.min(1, progress * 4);

    // Responsive orb radius — scales to viewport, capped at 120px
    this.lastOrbRadius = Math.min(120, Math.min(this.width, this.height) * 0.18);
    const orbRadius = this.lastOrbRadius;
    const checkSize = Math.min(48, orbRadius * 0.4);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = opacity;

    ctx.beginPath();
    ctx.arc(0, 0, orbRadius, 0, Math.PI * 2);
    const color = isCorrect ? 'hsl(145, 80%, 50%)' : 'hsl(0, 80%, 50%)';
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity * 0.15;
    ctx.fill();
    
    ctx.globalAlpha = opacity;
    ctx.font = `bold ${checkSize}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isCorrect ? 'hsl(145, 80%, 60%)' : 'hsl(0, 85%, 65%)';
    ctx.fillText(isCorrect ? '✓' : '✗', 0, 0);
    
    ctx.restore();
  }

  /** Draw a status badge (e.g., Lvl 5, 2 left) */
  protected draw_status_badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string = 'hsla(175, 70%, 50%, 0.6)', align: CanvasTextAlign = 'right'): void {
    ctx.save();
    ctx.font = '800 10px Outfit, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** Draw the standard background mesh texture (call once per frame, after fillRect) */
  protected draw_background_mesh(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.strokeStyle = 'hsla(175, 70%, 50%, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
    }
    for (let i = 0; i < h; i += 40) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }
  }

  /** Draw the standard HUD (trial counter top-right, optional difficulty badge top-left) */
  protected draw_hud(ctx: CanvasRenderingContext2D, w: number): void {
    this.draw_status_badge(ctx, w - 32, 40, `${this.currentTrial} / ${this.totalTrials}`, 'hsla(220, 15%, 55%, 0.8)');
    if (this._currentDifficulty > 1) {
      this.draw_status_badge(ctx, 32, 40, `Lvl ${this._currentDifficulty}`, 'hsla(175, 70%, 50%, 0.7)', 'left');
    }
  }

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
