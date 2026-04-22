// ============================================================
// NeuroSustain — Reaction Time Engine
// Simple stimulus-response for Processing Speed baseline
//
// Flow: wait (random 1-4s) → stimulus (green circle) → capture
// Records sub-ms precision via performance.now()
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, Trial, EngineCallbacks } from '@shared/types.ts';
import { SESSION, TIMING } from '@shared/constants.ts';
import { random_float, precise_now, format_ms } from '@shared/utils.ts';
import { t } from '@shared/i18n.ts';

type Phase = 'waiting' | 'ready' | 'too_early' | 'result' | 'countdown';

export class ReactionTimeEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'ReactionTime';
  readonly primaryPillar: CognitivePillar = 'ProcessingSpeed';
  readonly totalTrials: number = SESSION.TRIALS_PER_SESSION;

  private _phase: Phase = 'countdown';
  private _phaseStartTime: number = 0;
  private _stimulusTime: number = 0;
  private _delayMs: number = 0;
  private _lastReactionMs: number = 0;
  private _countdownValue: number = 3;

  // Visual animation state
  private _circleRadius: number = 0;
  private _circleTargetRadius: number = 0;
  private _pulsePhase: number = 0;
  private _feedbackOpacity: number = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStartTime = precise_now();
  }

  protected on_update(dt: number): void {
    const elapsed = precise_now() - this._phaseStartTime;

    switch (this._phase) {
      case 'countdown': {
        const newValue = 3 - Math.floor(elapsed / 800);
        if (newValue <= 0) {
          this._start_waiting();
        } else {
          this._countdownValue = newValue;
        }
        break;
      }

      case 'waiting':
        if (elapsed >= this._delayMs) {
          this._phase = 'ready';
          this._stimulusTime = precise_now();
          this._phaseStartTime = precise_now();
          this._circleTargetRadius = Math.min(this.width, this.height) * 0.12;
        }
        break;

      case 'ready':
        // Grow circle on appear
        this._circleRadius += (this._circleTargetRadius - this._circleRadius) * 0.15;
        this._pulsePhase += dt * 0.003;

        // Auto-miss after MAX_REACTION_MS
        if (elapsed >= TIMING.MAX_REACTION_MS) {
          this.record_trial(this._make_trial(false, TIMING.MAX_REACTION_MS));
          this._show_feedback(TIMING.MAX_REACTION_MS, false);
        }
        break;

      case 'too_early':
        this._feedbackOpacity = Math.max(0, 1 - elapsed / 1200);
        if (elapsed >= 1200) {
          this._start_waiting();
        }
        break;

      case 'result':
        this._feedbackOpacity = Math.max(0, 1 - elapsed / 1500);
        if (elapsed >= 1500) {
          if (this.currentTrial >= this.totalTrials) return; // Session complete
          this._start_waiting();
        }
        break;
    }
  }

  protected on_render(ctx: CanvasRenderingContext2D): void {
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;

    // Clear with dark background
    ctx.fillStyle = 'hsl(225, 45%, 6%)';
    ctx.fillRect(0, 0, w, h);

    // HUD: trial counter
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${this.currentTrial} / ${this.totalTrials}`,
      w - 32, 40
    );

    switch (this._phase) {
      case 'countdown':
        this._render_countdown(ctx, cx, cy);
        break;

      case 'waiting':
        this._render_waiting(ctx, cx, cy);
        break;

      case 'ready':
        this._render_stimulus(ctx, cx, cy);
        break;

      case 'too_early':
        this._render_too_early(ctx, cx, cy);
        break;

      case 'result':
        this._render_result(ctx, cx, cy);
        break;
    }

    // Instruction text at bottom
    ctx.font = '400 13px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 45%, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText(t('exercise.reaction.instruction'), cx, h - 40);
  }

  protected on_key_down(code: string, timestamp: number): void {
    if (code !== 'Space') return;

    switch (this._phase) {
      case 'waiting':
        // Too early!
        this._phase = 'too_early';
        this._phaseStartTime = precise_now();
        this._feedbackOpacity = 1;
        break;

      case 'ready': {
        const reactionMs = timestamp - this._stimulusTime;
        if (reactionMs < TIMING.MIN_REACTION_MS) {
          // Anticipatory — treat as too early
          this._phase = 'too_early';
          this._phaseStartTime = precise_now();
          this._feedbackOpacity = 1;
        } else {
          this.record_trial(this._make_trial(true, reactionMs));
          this._show_feedback(reactionMs, true);
        }
        break;
      }

      // Ignore during countdown, too_early, or result display
    }
  }

  protected on_cleanup(): void {
    // No external resources to clean up
  }

  // ── Private helpers ──

  private _start_waiting(): void {
    this._phase = 'waiting';
    this._phaseStartTime = precise_now();
    this._delayMs = random_float(SESSION.STIMULUS_DELAY_MIN_MS, SESSION.STIMULUS_DELAY_MAX_MS);
    this._circleRadius = 0;
    this._circleTargetRadius = 0;
    this._pulsePhase = 0;
  }

  private _show_feedback(reactionMs: number, correct: boolean): void {
    this._phase = 'result';
    this._phaseStartTime = precise_now();
    this._lastReactionMs = reactionMs;
    this._feedbackOpacity = 1;
    if (!correct) {
      this._lastReactionMs = -1; // Flag for "missed"
    }
  }

  private _make_trial(isCorrect: boolean, reactionTimeMs: number): Omit<Trial, 'id' | 'sessionId'> {
    return {
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: 1,
      isCorrect,
      reactionTimeMs,
      metadata: { trial: this.currentTrial + 1 },
    };
  }

  // ── Render methods ──

  private _render_countdown(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.font = 'bold 72px Inter, sans-serif';
    ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this._countdownValue), cx, cy);
  }

  private _render_waiting(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    // Dim pulsing circle (not green yet)
    const elapsed = precise_now() - this._phaseStartTime;
    const pulse = 0.3 + Math.sin(elapsed * 0.003) * 0.1;
    const r = Math.min(this.width, this.height) * 0.08;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(220, 20%, 25%, ${pulse})`;
    ctx.fill();

    // "Wait for it..." text
    ctx.font = '500 18px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.reaction.wait'), cx, cy + r + 40);
  }

  private _render_stimulus(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const r = this._circleRadius;
    const pulse = 1 + Math.sin(this._pulsePhase) * 0.05;
    const drawR = r * pulse;

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, drawR * 0.5, cx, cy, drawR * 2);
    glow.addColorStop(0, 'hsla(145, 65%, 48%, 0.15)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);

    // Main green circle
    ctx.beginPath();
    ctx.arc(cx, cy, drawR, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(cx - drawR * 0.2, cy - drawR * 0.2, 0, cx, cy, drawR);
    gradient.addColorStop(0, 'hsl(145, 70%, 58%)');
    gradient.addColorStop(1, 'hsl(145, 65%, 40%)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Inner highlight
    ctx.beginPath();
    ctx.arc(cx - drawR * 0.2, cy - drawR * 0.25, drawR * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(145, 80%, 75%, 0.3)';
    ctx.fill();

    // "NOW!" text
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.fillStyle = 'hsl(145, 70%, 55%)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.reaction.go'), cx, cy + drawR + 40);
  }

  private _render_too_early(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.globalAlpha = this._feedbackOpacity;

    // Red flash
    const r = Math.min(this.width, this.height) * 0.08;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(0, 75%, 55%, 0.6)';
    ctx.fill();

    ctx.font = '500 18px Inter, sans-serif';
    ctx.fillStyle = 'hsl(0, 75%, 65%)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.reaction.tooEarly'), cx, cy + r + 40);

    ctx.globalAlpha = 1;
  }

  private _render_result(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.globalAlpha = this._feedbackOpacity;

    if (this._lastReactionMs < 0) {
      // Missed
      ctx.font = '500 18px Inter, sans-serif';
      ctx.fillStyle = 'hsl(38, 90%, 55%)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('exercise.reaction.missed'), cx, cy);
    } else {
      // Show reaction time
      ctx.font = 'bold 56px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Color code: green < 250ms, teal < 400ms, yellow > 400ms
      if (this._lastReactionMs < 250) {
        ctx.fillStyle = 'hsl(145, 65%, 55%)';
      } else if (this._lastReactionMs < 400) {
        ctx.fillStyle = 'hsl(175, 70%, 50%)';
      } else {
        ctx.fillStyle = 'hsl(38, 90%, 55%)';
      }

      ctx.fillText(format_ms(this._lastReactionMs), cx, cy);

      ctx.font = '400 14px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 55%, 0.7)';
      ctx.fillText(
        t('exercise.reaction.result', { ms: Math.round(this._lastReactionMs) }),
        cx, cy + 40
      );
    }

    ctx.globalAlpha = 1;
  }
}
