// ============================================================
// NeuroSustain — High Number Engine (Numerical Stroop)
// Inhibitory Control — resist the physical size, select the
// numerically highest value.
//
// Difficulty scaling:
//   1-3: 2 numbers, distant values, minimal size difference
//   4-7: 2 numbers, close values, maximum incongruence
//   8-10: 3-4 numbers, close values, rotation + drift
//
// Based on the Numerical Stroop effect (Besner & Coltheart, 1979)
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, Trial, EngineCallbacks } from '@shared/types.ts';
import { precise_now, shuffle } from '@shared/utils.ts';
import { ObjectPool } from '@core/utils/object-pool.ts';

interface NumberOption {
  value: number;
  fontSize: number;
  x: number;
  y: number;
  rotation: number;       // radians
  driftSpeed: number;     // px/s drift for level 8+
  driftAngle: number;     // drift direction
  fontSizeBase: number;   // for dynamic scaling
  pulseOffset: number;    // for asynchronous breathing
  hitRect: { x: number; y: number; w: number; h: number };
}

type HighNumberPhase = 'countdown' | 'presenting' | 'feedback' | 'between';

export class HighNumberEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'HighNumber';
  readonly primaryPillar: CognitivePillar = 'InhibitoryControl';
  readonly totalTrials: number = 20;

  private _phase: HighNumberPhase = 'countdown';
  private _phaseStart: number = 0;
  private _countdownValue: number = 3;

  private _options: NumberOption[] = [];
  private _correctValue: number = 0;
  private _selectedValue: number = -1;
  private _trialReactionStart: number = 0;

  // Click handler stored for cleanup
  private _canvasClickHandler: ((e: PointerEvent) => void) | null = null;
  private _pool: ObjectPool<NumberOption>;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);

    this._pool = new ObjectPool<NumberOption>(() => ({
      value: 0,
      fontSize: 0,
      x: 0, y: 0,
      rotation: 0,
      driftSpeed: 0,
      driftAngle: 0,
      fontSizeBase: 0,
      pulseOffset: 0,
      hitRect: { x: 0, y: 0, w: 0, h: 0 }
    }), 10);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStart = precise_now();

    // Pointer input for number selection
    this._canvasClickHandler = (e: PointerEvent) => this._on_canvas_click(e);
    this.canvas.addEventListener('pointerdown', this._canvasClickHandler);
  }

  protected on_update(dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        const v = 3 - Math.floor(elapsed / 800);
        if (v <= 0) {
          this._generate_trial();
        } else {
          this._countdownValue = v;
        }
        break;
      }

      case 'presenting':
        // Animate drift at all levels (speed scales with difficulty)
        const dtSec = dt / 1000;
        for (const opt of this._options) {
          opt.x += Math.cos(opt.driftAngle) * opt.driftSpeed * dtSec;
          opt.y += Math.sin(opt.driftAngle) * opt.driftSpeed * dtSec;

          // Dynamic Scaling: "Breathe" the size so physical size isn't a cue
          const pulse = Math.sin((precise_now() / 1000) * 2 + opt.pulseOffset);
          opt.fontSize = opt.fontSizeBase + pulse * 15;

          // Bounce off edges
          const margin = opt.fontSize;
          if (opt.x < margin || opt.x > this.width - margin) opt.driftAngle = Math.PI - opt.driftAngle;
          if (opt.y < margin + 50 || opt.y > this.height - margin) opt.driftAngle = -opt.driftAngle;

          this._update_hit_rect(opt);
        }

        // Auto-miss after 5 seconds
        if (elapsed >= 5000) {
          this.record_trial(this._make_trial(false, 5000, -1));
          this._phase = 'feedback';
          this._phaseStart = precise_now();
        }
        break;

      case 'feedback':
        if (elapsed >= 1200) {
          if (this.currentTrial >= this.totalTrials) return;
          this._generate_trial();
        }
        break;

      case 'between':
        if (elapsed >= 500) {
          this._generate_trial();
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

    // HUD
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.currentTrial} / ${this.totalTrials}`, w - 32, 40);

    if (this.config.difficulty > 1) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = 'hsla(175, 70%, 50%, 0.5)';
      ctx.fillText(`LV ${this.config.difficulty}`, w - 32, 58);
    }

    switch (this._phase) {
      case 'countdown':
        ctx.font = 'bold 72px Inter, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(this._countdownValue), cx, cy);
        break;

      case 'presenting':
      case 'feedback':
        this._render_numbers(ctx);
        if (this._phase === 'presenting') {
          ctx.font = '400 14px Inter, sans-serif';
          ctx.fillStyle = 'hsla(220, 15%, 50%, 0.6)';
          ctx.textAlign = 'center';
          ctx.fillText('Select the highest number', cx, h - 40);
        }
        break;

      case 'between':
        // Brief blank
        break;
    }
  }

  protected on_key_down(_code: string, _timestamp: number): void {
    // This exercise uses pointer input only — keyboard does nothing
  }

  protected on_cleanup(): void {
    if (this._canvasClickHandler) {
      this.canvas.removeEventListener('pointerdown', this._canvasClickHandler);
    }
  }

  // ── Trial Generation ─────────────────────────────────────

  private _generate_trial(): void {
    // Release previous options back to the pool
    for (const opt of this._options) {
      this._pool.release(opt);
    }
    this._options = [];

    const diff = this.config.difficulty;
    const numOptions = diff >= 7 ? 5 : diff >= 4 ? 4 : 3;

    // Generate distinct random numbers
    const values = shuffle(this._generate_values(numOptions, diff));
    this._correctValue = Math.max(...values);

    // --- Numerical Stroop (Anti-Hack) ---
    // Congruent: biggest number = biggest size (trap for size-learners)
    // Neutral: all sizes random (baseline)
    // Incongruent: biggest number = smallest size (the real Stroop test)
    let stroopMode: 'congruent' | 'neutral' | 'incongruent' = 'neutral';
    if (diff >= 4) {
      const rand = Math.random();
      if (rand < 0.6) stroopMode = 'incongruent';
      else if (rand < 0.8) stroopMode = 'congruent';
      // else: neutral (20%)
    }

    for (const value of values) {
      let fontSizeBase: number;

      if (stroopMode === 'incongruent' && value === this._correctValue) {
        fontSizeBase = 40 + Math.random() * 10; // Correct = small (40-50)
      } else if (stroopMode === 'incongruent' && value !== this._correctValue) {
        fontSizeBase = 70 + Math.random() * 30; // Distractors = large (70-100)
      } else if (stroopMode === 'congruent' && value === this._correctValue) {
        fontSizeBase = 80 + Math.random() * 20; // Correct = large (trap)
      } else if (stroopMode === 'congruent' && value !== this._correctValue) {
        fontSizeBase = 40 + Math.random() * 20; // Distractors = small
      } else {
        fontSizeBase = 40 + Math.random() * 60; // Neutral: fully random
      }

      const rotation = (Math.random() - 0.5) * 0.3;

      const opt = this._pool.acquire();
      opt.value = value;
      opt.fontSizeBase = fontSizeBase;
      opt.fontSize = fontSizeBase;
      opt.pulseOffset = Math.random() * Math.PI * 2;
      opt.x = 0;
      opt.y = 0;
      opt.rotation = rotation;
      opt.driftSpeed = 15 + (diff * 5) + Math.random() * 20;
      opt.driftAngle = Math.random() * Math.PI * 2;
      
      this._options.push(opt);
    }

    // Position numbers with spacing
    this._position_options(this._options, numOptions);
    this._phase = 'presenting';
    this._phaseStart = precise_now();
    this._trialReactionStart = precise_now();
    this._selectedValue = -1;
  }

  private _generate_values(count: number, difficulty: number): number[] {
    const values: Set<number> = new Set();

    if (difficulty <= 3) {
      // Distant values (easy discrimination)
      while (values.size < count) {
        values.add(1 + Math.floor(Math.random() * 9));
      }
      // Ensure at least 4 apart
      const arr = [...values];
      if (arr.length === 2 && Math.abs(arr[0]! - arr[1]!) < 4) {
        return this._generate_values(count, difficulty);
      }
    } else {
      // Close values (hard discrimination)
      const base = 5 + Math.floor(Math.random() * (10 + difficulty * 8)); // Can go very high
      while (values.size < count) {
        values.add(base + values.size);
      }
    }

    return [...values];
  }

  private _position_options(options: NumberOption[], count: number): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const spreadX = this.width * 0.25;

    if (count === 2) {
      options[0]!.x = cx - spreadX;
      options[0]!.y = cy;
      options[1]!.x = cx + spreadX;
      options[1]!.y = cy;
    } else {
      // Arrange in a circle with random starting rotation
      const radius = Math.min(this.width, this.height) * 0.25;
      const startAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const angle = startAngle + (i / count) * Math.PI * 2;
        options[i]!.x = cx + Math.cos(angle) * radius;
        options[i]!.y = cy + Math.sin(angle) * radius;
      }
    }

    // Compute initial hit rects
    for (const opt of options) {
      this._update_hit_rect(opt);
    }
  }

  private _update_hit_rect(opt: NumberOption): void {
    const halfW = opt.fontSize * 0.6;
    const halfH = opt.fontSize * 0.6;
    opt.hitRect.x = opt.x - halfW;
    opt.hitRect.y = opt.y - halfH;
    opt.hitRect.w = halfW * 2;
    opt.hitRect.h = halfH * 2;
  }

  // ── Input ────────────────────────────────────────────────

  private _on_canvas_click(e: PointerEvent): void {
    if (this._phase !== 'presenting') return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Hit-test against all options
    for (const opt of this._options) {
      const hr = opt.hitRect;
      if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h) {
        const reactionMs = precise_now() - this._trialReactionStart;
        const correct = opt.value === this._correctValue;

        this._selectedValue = opt.value;
        this.record_trial(this._make_trial(correct, reactionMs, opt.value));

        this._phase = 'feedback';
        this._phaseStart = precise_now();
        return;
      }
    }
  }

  // ── Rendering ────────────────────────────────────────────

  private _render_numbers(ctx: CanvasRenderingContext2D): void {
    for (const opt of this._options) {
      ctx.save();
      ctx.translate(opt.x, opt.y);

      if (opt.rotation !== 0) {
        ctx.rotate(opt.rotation);
      }

      // Glow behind number
      const glowR = opt.fontSize * 0.8;
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
      glow.addColorStop(0, 'hsla(220, 30%, 20%, 0.3)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Number text
      ctx.font = `bold ${opt.fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Color: during feedback, highlight correct/incorrect
      if (this._phase === 'feedback') {
        if (opt.value === this._correctValue) {
          ctx.fillStyle = 'hsl(145, 65%, 55%)'; // Green = correct answer
        } else if (opt.value === this._selectedValue) {
          ctx.fillStyle = 'hsl(0, 75%, 55%)'; // Red = wrong selection
        } else {
          ctx.fillStyle = 'hsla(220, 15%, 55%, 0.3)';
        }
      } else {
        ctx.fillStyle = 'hsl(220, 20%, 88%)';
      }

      ctx.fillText(String(opt.value), 0, 0);

      ctx.restore();
    }
  }

  private _make_trial(isCorrect: boolean, reactionTimeMs: number, selectedValue: number): Omit<Trial, 'id' | 'sessionId'> {
    const correctOpt = this._options.find(o => o.value === this._correctValue);
    const selectedOpt = this._options.find(o => o.value === selectedValue);

    return {
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this.config.difficulty,
      isCorrect,
      reactionTimeMs,
      metadata: {
        trial: this.currentTrial + 1,
        correctValue: this._correctValue,
        selectedValue,
        fontSizeCorrect: correctOpt?.fontSize ?? 0,
        fontSizeDistractor: selectedOpt?.fontSize ?? 0,
        incongruent: this.config.difficulty >= 4,
        numOptions: this._options.length,
      },
    };
  }
}
