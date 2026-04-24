// ============================================================
// NeuroSustain — Stroop Task Engine
// Inhibitory Control + Processing Speed
//
// The user must identify the INK COLOR of a color word,
// suppressing the automatic reading response.
//
// Difficulty Scaling:
//   1-3: 50% congruent, 3 colors, 5s
//   4-7: 30% congruent, 4 colors, 4s
//   8-10: 10% congruent, 5 colors, 3s
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { get_locale } from '@shared/i18n.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'countdown' | 'stimulus' | 'feedback';

interface ColorDef {
  hsl: string;
  labelEn: string;
  labelEs: string;
  key: string; // Keyboard shortcut (1-5)
}

const ALL_COLORS: ColorDef[] = [
  { hsl: 'hsl(0, 75%, 55%)',   labelEn: 'RED',    labelEs: 'ROJO',     key: '1' },
  { hsl: 'hsl(220, 75%, 55%)', labelEn: 'BLUE',   labelEs: 'AZUL',     key: '2' },
  { hsl: 'hsl(130, 65%, 45%)', labelEn: 'GREEN',  labelEs: 'VERDE',    key: '3' },
  { hsl: 'hsl(50, 85%, 55%)',  labelEn: 'YELLOW', labelEs: 'AMARILLO', key: '4' },
  { hsl: 'hsl(280, 60%, 55%)', labelEn: 'PURPLE', labelEs: 'MORADO',   key: '5' },
];

export class StroopEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'StroopTask';
  readonly primaryPillar: CognitivePillar = 'InhibitoryControl';
  readonly totalTrials: number = 20;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;
  private _countdownValue: number = 3;

  // Trial state
  private _wordText: string = '';        // The word displayed (e.g. "RED")
  private _inkColor: string = '';        // The HSL color the word is rendered in
  private _correctColorIndex: number = 0; // Index into _activeColors of the correct answer
  private _isCongruent: boolean = false;
  private _isCorrect: boolean = false;
  private _timeLimitMs: number = 5000;

  // Active color pool (3-5 depending on difficulty)
  private _activeColors: ColorDef[] = [];
  private _locale: string = 'en';

  // Button geometry (pre-computed per trial — Zero-Allocation)
  private _btnRects: { x: number; y: number; w: number; h: number }[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._locale = get_locale();
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStart = precise_now();
    this._setup_color_pool();

    // Register click handler ONCE (Zero-Allocation)
    this.canvas.onclick = (e: MouseEvent) => {
      if (this._phase !== 'stimulus') return;
      const canvasRect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / canvasRect.width;
      const scaleY = this.height / canvasRect.height;
      const x = (e.clientX - canvasRect.left) * scaleX;
      const y = (e.clientY - canvasRect.top) * scaleY;

      for (let i = 0; i < this._btnRects.length; i++) {
        const r = this._btnRects[i]!;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          this._submit(i);
          return;
        }
      }
    };
  }

  private _setup_color_pool(): void {
    const diff = this._currentDifficulty;
    if (diff <= 3) {
      this._activeColors = ALL_COLORS.slice(0, 3);
    } else if (diff <= 7) {
      this._activeColors = ALL_COLORS.slice(0, 4);
    } else {
      this._activeColors = ALL_COLORS.slice(0, 5);
    }
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        const v = 3 - Math.floor(elapsed / 800);
        if (v <= 0) {
          this._next_trial();
        } else {
          this._countdownValue = v;
        }
        break;
      }

      case 'stimulus':
        if (elapsed >= this._timeLimitMs) {
          this._submit(-1); // Timeout — no answer
        }
        break;

      case 'feedback':
        if (elapsed > 1200) {
          if (this.currentTrial >= this.totalTrials) return;
          this._next_trial();
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

    if (this._currentDifficulty > 1) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = 'hsla(175, 70%, 50%, 0.5)';
      ctx.fillText(`LV ${this._currentDifficulty}`, w - 32, 58);
    }

    switch (this._phase) {
      case 'countdown':
        ctx.font = 'bold 72px Inter, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(this._countdownValue), cx, cy);
        break;

      case 'stimulus':
        this._render_stimulus(ctx, cx, cy, w, h);
        break;

      case 'feedback':
        this._render_feedback(ctx, cx, cy);
        break;
    }
  }

  private _render_stimulus(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, _h: number): void {
    const elapsed = precise_now() - this._phaseStart;

    // Time bar
    const progress = Math.min(1, elapsed / this._timeLimitMs);
    const barW = w - 120;
    const barH = 3;
    const barX = (w - barW) / 2;
    const barY = 70;

    ctx.fillStyle = 'hsla(220, 20%, 20%, 0.3)';
    ctx.fillRect(barX, barY, barW, barH);
    const hue = progress < 0.6 ? 175 : progress < 0.85 ? 45 : 0;
    ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
    ctx.fillRect(barX, barY, barW * (1 - progress), barH);

    // Instruction
    ctx.font = '400 13px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      this._locale === 'es' ? 'Selecciona el COLOR de la tinta' : 'Select the INK COLOR',
      cx, 100
    );

    // The Stroop word — displayed in the INK color
    const fontSize = Math.min(64, w * 0.12);
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = this._inkColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._wordText, cx, cy - 40);

    // Congruence indicator (subtle) for debugging — remove in production if desired
    // ctx.font = '400 11px Inter, sans-serif';
    // ctx.fillStyle = 'hsla(220, 15%, 40%, 0.4)';
    // ctx.fillText(this._isCongruent ? 'congruent' : 'incongruent', cx, cy + 10);

    // Color response buttons
    this._render_buttons(ctx);
  }

  private _render_buttons(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this._activeColors.length; i++) {
      const color = this._activeColors[i]!;
      const rect = this._btnRects[i]!;

      // Button background
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 10);
      ctx.fillStyle = 'hsla(225, 30%, 15%, 0.8)';
      ctx.fill();

      // Label (Monochromatic to prevent color-matching exploit)
      const label = this._locale === 'es' ? color.labelEs : color.labelEn;
      ctx.font = `600 ${Math.min(rect.h * 0.35, 16)}px Inter, sans-serif`;
      ctx.fillStyle = 'hsl(220, 20%, 85%)'; // Neutral text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);

      // Key hint
      ctx.font = '400 11px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 55%, 0.5)';
      ctx.textAlign = 'right';
      ctx.fillText(color.key, rect.x + rect.w - 8, rect.y + rect.h - 8);
    }
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.font = 'bold 48px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy - 20);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText('✗', cx, cy - 20);

      // Show correct answer
      const correct = this._activeColors[this._correctColorIndex]!;
      ctx.font = '500 18px Inter, sans-serif';
      ctx.fillStyle = correct.hsl;
      const label = this._locale === 'es' ? correct.labelEs : correct.labelEn;
      ctx.fillText(label, cx, cy + 24);
    }
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'stimulus') return;

    // Map Digit1-5 to color indices
    const match = code.match(/^(?:Digit|Numpad)(\d)$/);
    if (match) {
      const num = parseInt(match[1]!, 10);
      if (num >= 1 && num <= this._activeColors.length) {
        this._submit(num - 1);
      }
    }
  }

  protected on_cleanup(): void {
    this.canvas.onclick = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _next_trial(): void {
    const diff = this._currentDifficulty;
    const colors = this._activeColors;

    // Determine congruence
    let congruentChance: number;
    if (diff <= 3) congruentChance = 0.5;
    else if (diff <= 7) congruentChance = 0.3;
    else congruentChance = 0.1;

    this._isCongruent = Math.random() < congruentChance;

    // Pick a random ink color (this is the correct answer)
    const inkIndex = Math.floor(Math.random() * colors.length);
    this._correctColorIndex = inkIndex;
    this._inkColor = colors[inkIndex]!.hsl;

    // Pick the word text
    if (this._isCongruent) {
      // Word matches ink
      this._wordText = this._locale === 'es'
        ? colors[inkIndex]!.labelEs
        : colors[inkIndex]!.labelEn;
    } else {
      // Word must NOT match ink
      let wordIndex: number;
      do {
        wordIndex = Math.floor(Math.random() * colors.length);
      } while (wordIndex === inkIndex);
      this._wordText = this._locale === 'es'
        ? colors[wordIndex]!.labelEs
        : colors[wordIndex]!.labelEn;
    }

    // Time limit
    if (diff <= 3) this._timeLimitMs = 5000;
    else if (diff <= 7) this._timeLimitMs = 4000;
    else this._timeLimitMs = 3000;

    // Pre-compute button geometry (Zero-Allocation)
    this._compute_button_geometry();

    this._phase = 'stimulus';
    this._phaseStart = precise_now();
  }

  private _compute_button_geometry(): void {
    const count = this._activeColors.length;
    const totalW = Math.min(400, this.width - 60);
    const btnH = 44;
    const gap = 10;
    const totalH = count * btnH + (count - 1) * gap;
    const startX = (this.width - totalW) / 2;
    const startY = this.height - totalH - 40;

    // Reuse array if already allocated
    if (this._btnRects.length !== count) {
      this._btnRects = new Array(count);
      for (let i = 0; i < count; i++) {
        this._btnRects[i] = { x: 0, y: 0, w: 0, h: 0 };
      }
    }

    for (let i = 0; i < count; i++) {
      const rect = this._btnRects[i]!;
      rect.x = startX;
      rect.y = startY + i * (btnH + gap);
      rect.w = totalW;
      rect.h = btnH;
    }
  }

  private _submit(chosenIndex: number): void {
    const reactionMs = precise_now() - this._phaseStart;
    this._isCorrect = chosenIndex === this._correctColorIndex;

    if (this._isCorrect) {
      audioEngine.play_correct();
    } else {
      audioEngine.play_error();
    }

    const chosenColor = chosenIndex >= 0 ? this._activeColors[chosenIndex] : null;

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect: this._isCorrect,
      reactionTimeMs: reactionMs,
      metadata: {
        trial: this.currentTrial + 1,
        word: this._wordText,
        inkColor: this._inkColor,
        isCongruent: this._isCongruent,
        correctColor: this._locale === 'es'
          ? this._activeColors[this._correctColorIndex]!.labelEs
          : this._activeColors[this._correctColorIndex]!.labelEn,
        userChoice: chosenColor
          ? (this._locale === 'es' ? chosenColor.labelEs : chosenColor.labelEn)
          : 'timeout',
        timedOut: chosenIndex < 0,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
