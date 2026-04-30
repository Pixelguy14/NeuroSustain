// ============================================================
// NeuroSustain — Set Switching Engine
// Cognitive Flexibility
//
// Simulates the "context switch" cost that scrolling inflates.
// A shape appears; user classifies by one rule (COLOR or SHAPE).
// The rule changes every few trials.
//
// Difficulty Scaling:
//   1-3: 2 shapes × 2 colors, rule switch every 5 trials, 5s.
//   4-7: 3 shapes × 3 colors, switch every 3 trials, 4s.
//   8-10: 4 shapes × 4 colors, random switch (1-3), 3s. +SIZE.
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import { t } from '@shared/i18n.ts';

type Phase = 'countdown' | 'presenting' | 'feedback';
type Rule = 'color' | 'shape' | 'count';

interface ShapeConfig {
  name: string;
  color: string;
  colorName: string;
  shapeName: string;
  size: 'small' | 'large';
  count: number;
}

// Color palettes per level
const COLORS = [
  { name: 'RED', labelKey: 'exercise.setSwitch.colorRed', hsl: 'hsl(0, 70%, 55%)' },
  { name: 'BLUE', labelKey: 'exercise.setSwitch.colorBlue', hsl: 'hsl(210, 70%, 55%)' },
  { name: 'GREEN', labelKey: 'exercise.setSwitch.colorGreen', hsl: 'hsl(145, 65%, 50%)' },
  { name: 'YELLOW', labelKey: 'exercise.setSwitch.colorYellow', hsl: 'hsl(50, 85%, 55%)' },
];

const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
const SHAPE_LABEL_KEYS: Record<string, string> = {
  circle: 'exercise.setSwitch.shapeCircle',
  square: 'exercise.setSwitch.shapeSquare',
  triangle: 'exercise.setSwitch.shapeTriangle',
  diamond: 'exercise.setSwitch.shapeDiamond',
};

// Button geometry
const BTN_H = 48;
const BTN_GAP = 12;

export class SetSwitchingEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'SetSwitching';
  readonly primaryPillar: CognitivePillar = 'CognitiveFlexibility';
  readonly totalTrials: number = 20;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;

  // State
  private _currentRule: Rule = 'color';
  private _currentStimulus: ShapeConfig | null = null;
  private _options: string[] = []; // The category labels to choose from
  private _correctAnswer: string = '';
  private _trialsSinceSwitch: number = 0;
  private _switchEvery: number = 5;
  private _timeLimitMs: number = 5000;
  private _isCorrect: boolean = false;
  private _activeColors: number = 2;
  private _activeShapes: number = 2;
  private _activeCounts: number = 1;
  private _useSize: boolean = false;

  // Button geometry
  private _btnRects: { x: number; y: number; w: number; h: number; label: string }[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._phaseStart = precise_now();
    this._configure_difficulty();
    this._pick_initial_rule();
    this.start_countdown(() => this._next_trial());
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        // Handled by BaseEngine
        break;
      }

      case 'presenting':
        if (elapsed >= this._timeLimitMs) {
          this._submit_answer(null);
        }
        break;

      case 'feedback':
        if (elapsed > 1000) {
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
      ctx.fillText(t('session.difficulty', { level: this._currentDifficulty }), w - 32, 58);
    }

    switch (this._phase) {
      case 'countdown':
        break;

      case 'presenting':
        this._render_trial(ctx, cx, w, h);
        break;

      case 'feedback':
        this._render_feedback(ctx, cx, cy);
        break;
    }
  }

  private _render_trial(ctx: CanvasRenderingContext2D, cx: number, w: number, h: number): void {
    const elapsed = precise_now() - this._phaseStart;
    if (!this._currentStimulus) return;

    // Rule indicator (prominent)
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'center';

    const ruleLabel = this._currentRule === 'color' ? t('exercise.setSwitch.ruleColor')
      : this._currentRule === 'shape' ? t('exercise.setSwitch.ruleShape')
      : t('exercise.setSwitch.ruleCount');
    
    const ruleColor = this._currentRule === 'color' ? 'hsl(210, 70%, 60%)'
      : this._currentRule === 'shape' ? 'hsl(280, 60%, 60%)'
      : 'hsl(145, 60%, 60%)';

    // Rule pill
    const pillW = 200;
    const pillH = 32;
    const pillX = cx - pillW / 2;
    const pillY = 65;

    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = ruleColor.replace(')', ', 0.15)').replace('hsl', 'hsla');
    ctx.fill();
    ctx.strokeStyle = ruleColor.replace(')', ', 0.5)').replace('hsl', 'hsla');
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = ruleColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(ruleLabel, cx, pillY + pillH / 2);

    // Time bar
    const progress = Math.min(1, elapsed / this._timeLimitMs);
    const barW = w - 120;
    const barH = 3;
    const barX = (w - barW) / 2;
    const barY = pillY + pillH + 12;

    ctx.fillStyle = 'hsla(220, 20%, 20%, 0.3)';
    ctx.fillRect(barX, barY, barW, barH);
    const hue = progress < 0.6 ? 175 : progress < 0.85 ? 45 : 0;
    ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
    ctx.fillRect(barX, barY, barW * (1 - progress), barH);

    // Draw stimulus shape (centered)
    const stimY = h * 0.38;
    const stimSize = this._currentStimulus.size === 'large' ? 80 : (this._useSize ? 45 : 65);
    const stimColor = COLORS.find(c => c.name === this._currentStimulus!.colorName)?.hsl || 'hsl(0, 0%, 50%)';

    this._draw_shapes(ctx, this._currentStimulus, cx, stimY, stimSize, stimColor);

    // Draw option buttons
    const numBtns = this._options.length;
    const btnW = Math.min(140, (w - BTN_GAP * (numBtns + 1)) / numBtns);
    const totalBtnW = numBtns * btnW + (numBtns - 1) * BTN_GAP;
    const startX = cx - totalBtnW / 2;
    const btnY = h - BTN_H - 50;

    this._btnRects = [];

    for (let i = 0; i < numBtns; i++) {
      const bx = startX + i * (btnW + BTN_GAP);
      const label = this._options[i]!;

      this._btnRects.push({ x: bx, y: btnY, w: btnW, h: BTN_H, label });

      ctx.beginPath();
      ctx.roundRect(bx, btnY, btnW, BTN_H, 8);
      ctx.fillStyle = 'hsla(225, 30%, 15%, 0.6)';
      ctx.fill();
      ctx.strokeStyle = 'hsla(220, 20%, 35%, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.fillStyle = 'hsl(220, 15%, 75%)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + btnW / 2, btnY + BTN_H / 2);

      // Keyboard hint
      ctx.font = '400 10px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 50%, 0.4)';
      ctx.fillText(`[${i + 1}]`, bx + btnW / 2, btnY + BTN_H + 12);
    }
  }

  private _draw_shapes(ctx: CanvasRenderingContext2D, config: ShapeConfig, x: number, y: number, size: number, color: string): void {
    const count = config.count;
    const spacing = size * 0.8;
    
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    
    for (let i = 0; i < count; i++) {
      const offsetX = (i - (count - 1) / 2) * spacing;
      this._draw_single_shape(ctx, config.shapeName, x + offsetX, y, size, color);
    }
    
    ctx.shadowBlur = 0;
  }

  private _draw_single_shape(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    
    switch (shape) {
      case 'circle':
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        break;
      case 'square':
        ctx.roundRect(x - size / 2, y - size / 2, size, size, 4);
        break;
      case 'triangle': {
        const h = size * 0.866;
        ctx.moveTo(x, y - h / 2);
        ctx.lineTo(x - size / 2, y + h / 2);
        ctx.lineTo(x + size / 2, y + h / 2);
        ctx.closePath();
        break;
      }
      case 'diamond':
        ctx.moveTo(x, y - size / 2);
        ctx.lineTo(x + size / 2, y);
        ctx.lineTo(x, y + size / 2);
        ctx.lineTo(x - size / 2, y);
        ctx.closePath();
        break;
    }
    ctx.fill();
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText('✗', cx, cy - 16);
      ctx.font = '400 16px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
      ctx.fillText(this._correctAnswer, cx, cy + 20);
    }
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'presenting') return;

    let idx = -1;
    if (code === 'Digit1' || code === 'Numpad1') idx = 0;
    else if (code === 'Digit2' || code === 'Numpad2') idx = 1;
    else if (code === 'Digit3' || code === 'Numpad3') idx = 2;
    else if (code === 'Digit4' || code === 'Numpad4') idx = 3;

    if (idx >= 0 && idx < this._options.length) {
      this._submit_answer(this._options[idx]!);
    }
  }

  protected on_cleanup(): void {
    this.canvas.onpointerdown = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _configure_difficulty(): void {
    const diff = this._currentDifficulty;
    if (diff <= 3) {
      this._activeColors = 2;
      this._activeShapes = 2;
      this._activeCounts = 1;
      this._switchEvery = 5;
      this._timeLimitMs = 5000;
      this._useSize = false;
    } else if (diff <= 5) {
      this._activeColors = 3;
      this._activeShapes = 3;
      this._activeCounts = 3;
      this._switchEvery = 3;
      this._timeLimitMs = 4000;
      this._useSize = false;
    } else if (diff <= 8) {
      this._activeColors = 3;
      this._activeShapes = 3;
      this._activeCounts = 3;
      this._switchEvery = 2;
      this._timeLimitMs = 3500;
      this._useSize = true;
    } else {
      this._activeColors = 4;
      this._activeShapes = 4;
      this._activeCounts = 4;
      this._switchEvery = 1 + Math.floor(Math.random() * 2);
      this._timeLimitMs = 3000;
      this._useSize = true;
    }
  }

  private _pick_initial_rule(): void {
    const rules: Rule[] = this._currentDifficulty >= 4 ? ['color', 'shape', 'count'] : ['color', 'shape'];
    this._currentRule = rules[Math.floor(Math.random() * rules.length)]!;
    this._trialsSinceSwitch = 0;
  }

  private _next_trial(): void {
    // 1. MUST re-evaluate difficulty before doing any logic to catch dynamic shifts
    this._configure_difficulty();

    // Check if rule should switch
    this._trialsSinceSwitch++;
    if (this._trialsSinceSwitch > this._switchEvery) {
      this._switch_rule();
      this._trialsSinceSwitch = 1;
      // Re-randomize switch interval for high difficulty
      if (this._currentDifficulty >= 9) {
        this._switchEvery = 1 + Math.floor(Math.random() * 2);
      }
    }

    // Generate stimulus
    const colorIdx = Math.floor(Math.random() * this._activeColors);
    const shapeIdx = Math.floor(Math.random() * this._activeShapes);
    const countIdx = Math.floor(Math.random() * this._activeCounts);
    
    const size: 'small' | 'large' = this._useSize
      ? (Math.random() < 0.5 ? 'small' : 'large')
      : 'large';
 
    const color = COLORS[colorIdx]!;
    const shape = SHAPES[shapeIdx]!;
    const count = countIdx + 1;
 
    // Data-safe object (Machine-readable key for analytics)
    this._currentStimulus = {
      name: `${count}_${color.name}_${shape}_${size}`,
      color: color.hsl,
      colorName: color.name,
      shapeName: shape,
      size,
      count,
    };

    // Determine correct answer and options based on current rule
    if (this._currentRule === 'color') {
      this._correctAnswer = t(color.labelKey);
      this._options = COLORS.slice(0, this._activeColors).map(c => t(c.labelKey));
    } else if (this._currentRule === 'shape') {
      this._correctAnswer = t(SHAPE_LABEL_KEYS[shape]!).toUpperCase();
      this._options = SHAPES.slice(0, this._activeShapes).map(s => t(SHAPE_LABEL_KEYS[s]!).toUpperCase());
    } else {
      this._correctAnswer = String(count);
      this._options = ['1', '2', '3', '4'].slice(0, this._activeCounts);
    }

    // Register click handler with corrected coordinate scaling
    this.canvas.onpointerdown = (e: MouseEvent) => {
      if (this._phase !== 'presenting') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      for (const btn of this._btnRects) {
        if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
          this._submit_answer(btn.label);
          return;
        }
      }
    };

    this._phase = 'presenting';
    this._phaseStart = precise_now();
  }

  private _switch_rule(): void {
    const rules: Rule[] = this._currentDifficulty >= 4 ? ['color', 'shape', 'count'] : ['color', 'shape'];
    let newRule: Rule;
    do {
      newRule = rules[Math.floor(Math.random() * rules.length)]!;
    } while (newRule === this._currentRule && rules.length > 1);
    this._currentRule = newRule;
    audioEngine.play_transition();
  }

  private _submit_answer(answer: string | null): void {
    if (!this._currentStimulus) return;

    const reactionMs = precise_now() - this._phaseStart;

    if (answer === null) {
      this._isCorrect = false;
    } else {
      this._isCorrect = answer === this._correctAnswer;
    }

    if (this._isCorrect) {
      audioEngine.play_correct();
    } else {
      audioEngine.play_error();
    }

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect: this._isCorrect,
      reactionTimeMs: reactionMs,
      metadata: {
        trial: this.currentTrial + 1,
        rule: this._currentRule,
        stimulus: this._currentStimulus.name,
        correctAnswer: this._correctAnswer,
        userAnswer: answer,
        timedOut: answer === null,
        trialsSinceSwitch: this._trialsSinceSwitch,
      }
    });

    this.canvas.onpointerdown = null;
    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
