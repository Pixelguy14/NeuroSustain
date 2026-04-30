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
//   8-10: 4 shapes × 4 colors, random switch (1-3), 3s. + quantity of shapes.
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
  private _btnPressMs: number[] = [];
  private _btnGradients: CanvasGradient[] = [];
  private _boundPointerDown = (e: MouseEvent) => this._handle_input(e);

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._phaseStart = precise_now();
    this._configure_difficulty();
    this._pick_initial_rule();
    
    // Register unified listener
    this.canvas.addEventListener('pointerdown', this._boundPointerDown);
    
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

    // Background texture
    this.draw_background_mesh(ctx, w, h);

    // HUD
    this.draw_hud(ctx, w);

    switch (this._phase) {
      case 'countdown':
        break;

      case 'presenting':
        this._render_trial(ctx, cx, w, h);
        break;

      case 'feedback':
        const progress = (precise_now() - this._phaseStart) / 1000;
        this.draw_feedback_orb(ctx, cx, cy, this._isCorrect, progress);
        if (!this._isCorrect) {
            ctx.font = '600 16px Outfit, sans-serif';
            ctx.fillStyle = 'hsla(0, 0%, 100%, 0.7)';
            ctx.textAlign = 'center';
            ctx.fillText(this._correctAnswer, cx, cy + 40);
        }
        break;
    }
  }

  private _render_trial(ctx: CanvasRenderingContext2D, cx: number, w: number, h: number): void {
    const elapsed = precise_now() - this._phaseStart;
    if (!this._currentStimulus) return;

    // Rule indicator (prominent)
    ctx.font = 'bold 13px Outfit, sans-serif';
    ctx.textAlign = 'center';

    const ruleLabel = this._currentRule === 'color' ? t('exercise.setSwitch.ruleColor')
      : this._currentRule === 'shape' ? t('exercise.setSwitch.ruleShape')
        : t('exercise.setSwitch.ruleCount');

    const ruleColor = this._currentRule === 'color' ? 'hsl(210, 80%, 65%)'
      : this._currentRule === 'shape' ? 'hsl(280, 75%, 70%)'
        : 'hsl(145, 75%, 65%)';

    // Rule pill
    const pillW = 180;
    const pillH = 36;
    const pillX = cx - pillW / 2;
    const pillY = 75;

    this.draw_glass_panel(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = ruleColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(ruleLabel, cx, pillY + pillH / 2);

    // Time bar
    const progress = Math.min(1, elapsed / this._timeLimitMs);
    const barW = w - 160;
    const barH = 3;
    const barX = (w - barW) / 2;
    const barY = pillY + pillH + 16;

    ctx.fillStyle = 'hsla(220, 20%, 20%, 0.3)';
    ctx.fillRect(barX, barY, barW, barH);
    
    if (progress < 0.6) ctx.fillStyle = 'hsl(175, 70%, 55%)';
    else if (progress < 0.85) ctx.fillStyle = 'hsl(45, 70%, 55%)';
    else ctx.fillStyle = 'hsl(0, 70%, 55%)';
    
    ctx.fillRect(barX, barY, barW * (1 - progress), barH);

    // Stimulus stage (Glass panel)
    const stageW = Math.min(320, w - 64);
    const stageH = 160;
    const stageY = barY + 30;
    this.draw_glass_panel(ctx, cx - stageW / 2, stageY, stageW, stageH, 16);

    // Draw stimulus shape (centered on stage)
    const stimY = stageY + stageH / 2;
    const isMobile = w < 600;
    let stimSize = this._currentStimulus.size === 'large' ? 80 : (this._useSize ? 45 : 65);
    if (isMobile && this._currentStimulus.count > 3) stimSize *= 0.8;
    
    const stimColor = COLORS.find(c => c.name === this._currentStimulus!.colorName)?.hsl || 'hsl(0, 0%, 50%)';

    this._draw_shapes(ctx, this._currentStimulus, cx, stimY, stimSize, stimColor);

    // Draw option buttons
    const numBtns = this._options.length;
    const btnW = Math.min(140, (w - BTN_GAP * (numBtns + 1)) / numBtns);
    const totalBtnW = numBtns * btnW + (numBtns - 1) * BTN_GAP;
    const startX = cx - totalBtnW / 2;
    const btnY = h - BTN_H - 60;

    const now = precise_now();
    for (let i = 0; i < numBtns; i++) {
      const bx = startX + i * (btnW + BTN_GAP);
      const label = this._options[i]!;
      const pressElapsed = now - (this._btnPressMs[i] || 0);
      const isPressed = pressElapsed < 100;

      this._btnRects[i] = { x: bx, y: btnY, w: btnW, h: BTN_H, label };

      this.draw_tactile_button(
          ctx, bx, btnY, btnW, BTN_H,
          label,
          {
              bg: (this._btnGradients[i] || 'hsla(225, 30%, 15%, 0.6)') as any,
              stroke: isPressed ? 'hsl(175, 70%, 50%)' : 'hsla(220, 20%, 35%, 0.3)',
              text: isPressed ? 'white' : 'hsl(220, 15%, 85%)'
          },
          isPressed
      );

      // Keyboard hint
      ctx.textAlign = 'center';
      ctx.font = '600 10px Outfit, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 50%, 0.4)';
      ctx.fillText(`${i + 1}`, bx + btnW / 2, btnY + BTN_H + 16);
    }
  }

  private _draw_shapes(ctx: CanvasRenderingContext2D, config: ShapeConfig, x: number, y: number, size: number, color: string): void {
    const count = config.count;
    const isMobile = this.width < 600;
    const spacing = isMobile ? size * 1.1 : size * 1.5; 

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    for (let i = 0; i < count; i++) {
      const offsetX = (i - (count - 1) / 2) * spacing;
      this._draw_single_shape(ctx, config.shapeName, x + offsetX, y, size, color);
    }

    ctx.restore();
  }

  private _draw_single_shape(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number, color: string): void {
    // Tactile Gradient for shape
    const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color.replace('55%)', '35%)').replace('50%)', '30%)'));
    ctx.fillStyle = grad;

    ctx.beginPath();
    switch (shape) {
      case 'circle':
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        break;
      case 'square':
        ctx.roundRect(x - size / 2, y - size / 2, size, size, 6);
        break;
      case 'triangle': {
        const h = size * 0.866;
        ctx.moveTo(x, y - h * 0.6);
        ctx.lineTo(x - size / 2, y + h * 0.4);
        ctx.lineTo(x + size / 2, y + h * 0.4);
        ctx.closePath();
        break;
      }
      case 'diamond':
        ctx.moveTo(x, y - size / 1.8);
        ctx.lineTo(x + size / 1.8, y);
        ctx.lineTo(x, y + size / 1.8);
        ctx.lineTo(x - size / 1.8, y);
        ctx.closePath();
        break;
    }
    ctx.fill();

    // Subtle highlight line
    ctx.strokeStyle = 'hsla(0, 0%, 100%, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
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
    this.canvas.removeEventListener('pointerdown', this._boundPointerDown);
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

    // Re-compute gradients and geometry for options
    this._btnRects = [];
    this._btnPressMs = new Array(this._options.length).fill(0);
    this._btnGradients = [];

    const numBtns = this._options.length;
    const btnW = Math.min(140, (this.width - BTN_GAP * (numBtns + 1)) / numBtns);
    const btnY = this.height - BTN_H - 60;

    for (let i = 0; i < numBtns; i++) {
        const bx = (this.width / 2) - (numBtns * btnW + (numBtns - 1) * BTN_GAP) / 2 + i * (btnW + BTN_GAP);
        const grad = this.ctx.createLinearGradient(bx, btnY, bx, btnY + BTN_H);
        grad.addColorStop(0, 'hsla(225, 30%, 18%, 0.8)');
        grad.addColorStop(1, 'hsla(225, 35%, 12%, 0.9)');
        this._btnGradients.push(grad);
    }

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
  private _handle_input(e: MouseEvent): void {
    if (this._phase !== 'presenting') return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    for (let i = 0; i < this._btnRects.length; i++) {
      const btn = this._btnRects[i]!;
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        this._btnPressMs[i] = precise_now();
        this._submit_answer(btn.label);
        return;
      }
    }
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

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
