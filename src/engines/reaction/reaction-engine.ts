// ============================================================
// NeuroSustain — Reaction Time Engine v2
// Processing Speed baseline with dynamic difficulty
//
// Level scaling:
//   1-2: Static green circle, center screen (baseline)
//   3-4: Circle spawns at random screen quadrant
//   5-7: Fakeout circles (red/blue, 15% chance) — must NOT click
//   8-10: Moving targets + 30% fakeouts + multiple distractors
//
// Records sub-ms precision via performance.now()
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, Trial, EngineCallbacks } from '@shared/types.ts';
import { SESSION, TIMING, DIFFICULTY } from '@shared/constants.ts';
import { random_float, precise_now, format_ms } from '@shared/utils.ts';
import { t } from '@shared/i18n.ts';

type Phase = 'waiting' | 'ready' | 'fakeout' | 'too_early' | 'result' | 'countdown';

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
  private _isFakeout: boolean = false;
  private _isFakeoutError: boolean = false;
  private _targetColor: string = 'hsl(145, 70%, 58%)';
  private _targetDarkColor: string = 'hsl(145, 65%, 40%)';
  private _targetKey: string = 'Space';
  private _targetLabel: string = 'SPACE';

  // Session-specific active targets (max 3 valid colors)
  private _activeTargets: { color: string; dark: string; key: string; label: string; name: string }[] = [];

  // Visual animation state
  private _circleRadius: number = 0;
  private _circleTargetRadius: number = 0;
  private _pulsePhase: number = 0;
  private _feedbackOpacity: number = 0;

  // Dynamic position (for level 3+ random placement, level 8+ movement)
  private _stimulusX: number = 0;
  private _stimulusY: number = 0;
  private _movementTime: number = 0;
  private _movementCenterX: number = 0;
  private _movementCenterY: number = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStartTime = precise_now();

    // Select max 3 colors per session to avoid overwhelming the user
    // Green (Space) is always included as the baseline
    const allTargets = [
      { color: 'hsl(210, 80%, 55%)', dark: 'hsl(210, 70%, 40%)', key: 'KeyW', label: 'PRESS W', name: 'BLUE' },
      { color: 'hsl(45, 95%, 55%)', dark: 'hsl(45, 80%, 40%)', key: 'KeyS', label: 'PRESS S', name: 'YELLOW' },
      { color: 'hsl(280, 70%, 60%)', dark: 'hsl(280, 60%, 45%)', key: 'KeyD', label: 'PRESS D', name: 'PURPLE' }
    ];
    
    // Shuffle and pick 2 distractors
    for (let i = allTargets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTargets[i], allTargets[j]] = [allTargets[j]!, allTargets[i]!];
    }
    
    this._activeTargets = [
      { color: 'hsl(145, 70%, 58%)', dark: 'hsl(145, 65%, 40%)', key: 'Space', label: 'SPACE', name: 'GREEN' },
      allTargets[0]!,
      allTargets[1]!
    ];
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
          this._begin_stimulus();
        }
        break;

      case 'ready':
        this._circleRadius += (this._circleTargetRadius - this._circleRadius) * 0.15;
        this._pulsePhase += dt * 0.003;

        // Level 2+: animate position
        if (this.config.difficulty >= 2) {
          this._movementTime += dt * 0.001;
          const speed = 1.0 + (this.config.difficulty * 0.2);
          this._stimulusX = this._movementCenterX + Math.sin(this._movementTime * speed) * (this.width * 0.15);
          this._stimulusY = this._movementCenterY + Math.cos(this._movementTime * speed * 0.7) * (this.height * 0.1);
        }

        if (elapsed >= TIMING.MAX_REACTION_MS) {
          this.record_trial(this._make_trial(false, TIMING.MAX_REACTION_MS, false));
          this._show_feedback(TIMING.MAX_REACTION_MS, false);
        }

        // Clamp to screen
        const rMargin = this._circleTargetRadius * 1.5;
        this._stimulusX = Math.max(rMargin, Math.min(this.width - rMargin, this._stimulusX));
        this._stimulusY = Math.max(rMargin, Math.min(this.height - rMargin, this._stimulusY));
        break;

      case 'fakeout':
        this._circleRadius += (this._circleTargetRadius - this._circleRadius) * 0.15;
        this._pulsePhase += dt * 0.003;

        // Level 2+: animate fakeout position too
        if (this.config.difficulty >= 2) {
          this._movementTime += dt * 0.001;
          const speed = 1.0 + (this.config.difficulty * 0.2);
          this._stimulusX = this._movementCenterX + Math.sin(this._movementTime * speed) * (this.width * 0.15);
          this._stimulusY = this._movementCenterY + Math.cos(this._movementTime * speed * 0.7) * (this.height * 0.1);
        }

        // Fakeout auto-clears after 1.5s — user should NOT have pressed
        if (elapsed >= 1500) {
          // Inhibition success — record as True Negative trial
          this.record_trial(this._make_trial(true, 1500, true));
          this._start_waiting();
        }

        // Clamp to screen
        const margin = this._circleTargetRadius * 1.5;
        this._stimulusX = Math.max(margin, Math.min(this.width - margin, this._stimulusX));
        this._stimulusY = Math.max(margin, Math.min(this.height - margin, this._stimulusY));
        break;

      case 'too_early':
        this._feedbackOpacity = Math.max(0, 1 - elapsed / 3000);
        if (elapsed >= 3000) {
          this._start_waiting();
        }
        break;

      case 'result':
        this._feedbackOpacity = Math.max(0, 1 - elapsed / 1500);
        if (elapsed >= 1500) {
          if (this.currentTrial >= this.totalTrials) return;
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

    ctx.fillStyle = 'hsl(225, 45%, 6%)';
    ctx.fillRect(0, 0, w, h);

    // HUD: trial counter + difficulty badge
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.currentTrial} / ${this.totalTrials}`, w - 32, 40);

    if (this._currentDifficulty > 1) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = 'hsla(175, 70%, 50%, 0.5)';
      ctx.fillText(`LV ${this._currentDifficulty}`, w - 32, 58);
    }

    switch (this._phase) {
      case 'countdown':
        this._render_countdown(ctx, cx, cy);
        break;
      case 'waiting':
        this._render_waiting(ctx, this._stimulusX, this._stimulusY);
        break;
      case 'ready':
        this._render_stimulus(ctx, this._stimulusX, this._stimulusY, this._targetColor, this._targetDarkColor);
        break;
      case 'fakeout':
        this._render_stimulus(ctx, this._stimulusX, this._stimulusY, 'hsl(0, 75%, 55%)', 'hsl(0, 60%, 40%)');
        this._render_fakeout_warning(ctx, this._stimulusX, this._stimulusY);
        break;
      case 'too_early':
        this._render_too_early(ctx, cx, cy);
        break;
      case 'result':
        this._render_result(ctx, cx, cy);
        break;
    }

    // Instruction text at bottom
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
    ctx.textAlign = 'center';
    
    let instruction = t('exercise.reaction.instruction');
    if (this._currentDifficulty >= 4) {
      const keys = this._activeTargets.map(t => `${t.name === 'GREEN' ? 'SPACE' : t.key.replace('Key', '')} for ${t.name}`).join(', ');
      instruction = `Press ${keys}. IGNORE RED.`;
    }
    ctx.fillText(instruction, cx, h - 40);
  }

  protected on_key_down(code: string, timestamp: number): void {
    if (this._phase === 'waiting') {
      // False Alarm — record as failed trial + 3s cooldown penalty
      this.record_trial(this._make_trial(false, 0, false));
      this._phase = 'too_early';
      this._phaseStartTime = precise_now();
      this._feedbackOpacity = 1;
      return;
    }

    if (this._phase === 'fakeout') {
      // User pressed during a fakeout — WRONG
      this._isFakeoutError = true;
      this.record_trial(this._make_trial(false, timestamp - this._stimulusTime, true));
      this._show_feedback(-1, false);
      return;
    }

    if (this._phase === 'ready') {
      const reactionMs = timestamp - this._stimulusTime;
      const correctKey = code === this._targetKey;

      if (reactionMs < TIMING.MIN_REACTION_MS) {
        this._phase = 'too_early';
        this._phaseStartTime = precise_now();
        this._feedbackOpacity = 1;
      } else if (!correctKey) {
        // Wrong key pressed
        this._isFakeoutError = true; // Use this to show a "Wrong Key" message
        this.record_trial(this._make_trial(false, reactionMs, false));
        this._show_feedback(-1, false);
      } else {
        this.record_trial(this._make_trial(true, reactionMs, false));
        this._show_feedback(reactionMs, true);
      }
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
    this._isFakeout = false;
    this._isFakeoutError = false;
    this._movementTime = 0;

    // Calculate position early so the waiting pulse spawns there
    const diff = this._currentDifficulty;
    if (diff >= 2) {
      const margin = Math.min(this.width, this.height) * 0.2;
      this._stimulusX = margin + Math.random() * (this.width - margin * 2);
      this._stimulusY = margin + Math.random() * (this.height - margin * 2);
    } else {
      this._stimulusX = this.width / 2;
      this._stimulusY = this.height / 2;
    }

    this._movementCenterX = this._stimulusX;
    this._movementCenterY = this._stimulusY;
  }

  /** Decide stimulus position and whether it's a fakeout, then enter the right phase */
  private _begin_stimulus(): void {
    const diff = this._currentDifficulty;

    // Position is already decided in _start_waiting() so the pulse decays into the actual target.

    // Determine if fakeout
    const fakeoutChance = diff >= 6
      ? DIFFICULTY.FAKEOUT_CHANCE_HARD
      : diff >= 2
        ? DIFFICULTY.FAKEOUT_CHANCE_BASE
        : 0;

    this._isFakeout = Math.random() < fakeoutChance;

    // Set target radius
    this._circleTargetRadius = Math.min(this.width, this.height) * 0.12;
    this._stimulusTime = precise_now();
    this._phaseStartTime = precise_now();

    if (this._isFakeout) {
      this._phase = 'fakeout';
    } else {
      // Pick target key and color based on difficulty
      if (diff >= 4) {
        const choice = Math.floor(Math.random() * this._activeTargets.length);
        const t = this._activeTargets[choice]!;
        this._targetColor = t.color;
        this._targetDarkColor = t.dark;
        this._targetKey = t.key;
        this._targetLabel = t.label;
      } else {
        this._targetColor = 'hsl(145, 70%, 58%)';
        this._targetDarkColor = 'hsl(145, 65%, 40%)';
        this._targetKey = 'Space';
        this._targetLabel = t('exercise.reaction.go');
      }
      this._phase = 'ready';
    }
  }

  private _show_feedback(reactionMs: number, correct: boolean): void {
    this._phase = 'result';
    this._phaseStartTime = precise_now();
    this._lastReactionMs = reactionMs;
    this._feedbackOpacity = 1;
    if (!correct) {
      this._lastReactionMs = -1;
    }
  }

  private _make_trial(isCorrect: boolean, reactionTimeMs: number, wasFakeout: boolean): Omit<Trial, 'id' | 'sessionId'> {
    return {
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect,
      reactionTimeMs,
      metadata: {
        trial: this.currentTrial + 1,
        fakeout: wasFakeout,
        positionX: Math.round(this._stimulusX),
        positionY: Math.round(this._stimulusY),
        isChoiceRT: this._currentDifficulty >= 4,
        numChoices: this._currentDifficulty >= 4 ? this._activeTargets.length : 1,
      },
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
    const elapsed = precise_now() - this._phaseStartTime;
    const pulse = 0.3 + Math.sin(elapsed * 0.003) * 0.1;
    const r = Math.min(this.width, this.height) * 0.08;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(220, 20%, 25%, ${pulse})`;
    ctx.fill();

    ctx.font = '500 18px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.reaction.wait'), cx, cy + r + 40);
  }

  /** Render stimulus (green for real, red for fakeout — colors passed as params) */
  private _render_stimulus(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    colorBright: string, colorDark: string
  ): void {
    const r = this._circleRadius;
    const pulse = 1 + Math.sin(this._pulsePhase) * 0.05;
    const drawR = r * pulse;

    // Outer glow
    const glow = ctx.createRadialGradient(sx, sy, drawR * 0.5, sx, sy, drawR * 2);
    glow.addColorStop(0, colorBright.replace('hsl(', 'hsla(').replace(')', ', 0.15)'));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);

    // Main circle
    ctx.beginPath();
    ctx.arc(sx, sy, drawR, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(sx - drawR * 0.2, sy - drawR * 0.2, 0, sx, sy, drawR);
    gradient.addColorStop(0, colorBright);
    gradient.addColorStop(1, colorDark);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Inner highlight
    ctx.beginPath();
    ctx.arc(sx - drawR * 0.2, sy - drawR * 0.25, drawR * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(0, 0%, 100%, 0.2)';
    ctx.fill();

    // Action label
    if (this._phase === 'ready') {
      ctx.font = 'bold 24px Inter, sans-serif';
      ctx.fillStyle = colorBright;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._targetLabel, sx, sy + drawR + 40);
    }
  }

  /** Render "DON'T CLICK" warning under fakeout circle */
  private _render_fakeout_warning(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    const r = this._circleRadius;
    ctx.font = '600 16px Inter, sans-serif';
    ctx.fillStyle = 'hsla(0, 75%, 60%, 0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕ WAIT', sx, sy + r + 40);
  }

  private _render_too_early(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.globalAlpha = this._feedbackOpacity;

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
      ctx.font = '500 18px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      if (this._isFakeoutError) {
        ctx.fillStyle = 'hsl(0, 75%, 65%)';
        ctx.fillText('Wrong Input / Ignored Rule!', cx, cy);
      } else {
        ctx.fillStyle = 'hsl(38, 90%, 55%)';
        ctx.fillText(t('exercise.reaction.missed'), cx, cy);
      }
    } else {
      ctx.font = 'bold 56px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

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
