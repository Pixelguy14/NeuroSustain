// ============================================================
// NeuroSustain — Serial Subtraction Engine
// Working Memory — clinical-grade mental arithmetic test
//
// Mechanic: Starting number → subtract → answer disappears
// ("scribbled over") → hold new base in working memory → repeat
//
// Difficulty scaling:
//   1-3: Start 50-100, subtrahend 3/4/5, no rule changes
//   4-7: Start 100-500, subtrahend 7/9/11, changes every 3 correct
//   8-10: Start 200-999, subtrahend 13/17/19, changes every 2,
//         direction flip (sub→add→sub) at boundaries
//
// Input: Canvas virtual numpad (touch/click) + physical keyboard
// via InputBridge for unified latency normalization
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { DIFFICULTY } from '@shared/constants.ts';
import { precise_now } from '@shared/utils.ts';
import { InputBridge } from '@core/input/input-bridge.ts';
import type { InputEvent } from '@core/input/input-bridge.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type SerialPhase = 'countdown' | 'active' | 'feedback' | 'scribble' | 'subtrahend_change';

/** Numpad button layout */
interface NumpadButton {
  label: string;
  value: string;
  col: number;
  row: number;
}

const NUMPAD_LAYOUT: NumpadButton[] = [
  { label: '7', value: '7', col: 0, row: 0 },
  { label: '8', value: '8', col: 1, row: 0 },
  { label: '9', value: '9', col: 2, row: 0 },
  { label: '4', value: '4', col: 0, row: 1 },
  { label: '5', value: '5', col: 1, row: 1 },
  { label: '6', value: '6', col: 2, row: 1 },
  { label: '1', value: '1', col: 0, row: 2 },
  { label: '2', value: '2', col: 1, row: 2 },
  { label: '3', value: '3', col: 2, row: 2 },
  { label: '⌫', value: 'Backspace', col: 0, row: 3 },
  { label: '0', value: '0', col: 1, row: 3 },
  { label: '↵', value: 'Enter', col: 2, row: 3 },
];

export class SerialSubtractionEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'SerialSubtraction';
  readonly primaryPillar: CognitivePillar = 'WorkingMemory';
  readonly totalTrials: number = 15;

  private _phase: SerialPhase = 'countdown';
  private _phaseStart: number = 0;
  private _countdownValue: number = 3;

  // Arithmetic state
  private _currentNumber: number = 0;
  private _subtrahend: number = 7;
  private _expectedAnswer: number = 0;
  private _isAdding: boolean = false; // Level 8+: direction flip
  private _consecutiveCorrect: number = 0;
  private _chainLength: number = 0;
  private _ruleChangeEvery: number = DIFFICULTY.SERIAL_SUB_RULE_CHANGE_EVERY;

  // Input state
  private _userInput: string = '';
  private _inputBridge: InputBridge | null = null;
  private _trialStartTime: number = 0;
  private _lastInputMode: 'keyboard' | 'touch' = 'keyboard';

  // Animation
  private _scribbleLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  private _wasCorrect: boolean = false;
  private _feedbackText: string = '';

  // Numpad geometry (computed on resize)
  private _numpadX: number = 0;
  private _numpadY: number = 0;
  private _btnW: number = 0;
  private _btnH: number = 0;
  private _numpadGap: number = 6;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStart = precise_now();
    this._userInput = '';
    this._consecutiveCorrect = 0;
    this._chainLength = 0;
    this._isAdding = false;

    // Initialize arithmetic based on difficulty
    this._init_arithmetic();

    // Compute numpad geometry
    this._compute_numpad_layout();

    // Set up InputBridge
    this._inputBridge = new InputBridge(this.canvas, (x, y) => this._hit_test_numpad(x, y));
    this._inputBridge.on_input((event: InputEvent) => this._on_input(event));
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        const v = 3 - Math.floor(elapsed / 800);
        if (v <= 0) {
          this._start_active();
        } else {
          this._countdownValue = v;
        }
        break;
      }

      case 'active':
        // Waiting for user input — nothing to animate
        break;

      case 'feedback':
        if (elapsed >= 1000) {
          if (this.currentTrial >= this.totalTrials) return;
          this._phase = 'scribble';
          this._phaseStart = precise_now();
          this._generate_scribble();
        }
        break;

      case 'scribble':
        if (elapsed >= 1000) {
          this._advance_to_next();
        }
        break;

      // Subtrahend change phase removed per user request
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

      case 'active':
        this._render_chalkboard(ctx);
        this._render_numpad(ctx);
        this._render_input_display(ctx);
        break;

      case 'feedback':
        this._render_chalkboard(ctx);
        this._render_numpad(ctx);
        this._render_feedback(ctx);
        break;

      case 'scribble':
        this._render_chalkboard_with_scribble(ctx);
        this._render_numpad(ctx);
        break;

      // Subtrahend change phase removed
    }
  }

  protected on_key_down(_code: string, _timestamp: number): void {
    // Keyboard input is handled by InputBridge — no direct handling needed
  }

  protected on_cleanup(): void {
    this._inputBridge?.destroy();
    this._inputBridge = null;
  }

  // ── Arithmetic Logic ─────────────────────────────────────

  private _init_arithmetic(): void {
    const diff = this.config.difficulty;

    if (diff <= 3) {
      this._currentNumber = 50 + Math.floor(Math.random() * 51); // 50-100
      this._subtrahend = [3, 4, 5][Math.floor(Math.random() * 3)]!;
    } else if (diff <= 7) {
      this._currentNumber = 100 + Math.floor(Math.random() * 401); // 100-500
      this._subtrahend = [7, 9, 11][Math.floor(Math.random() * 3)]!;
    } else {
      this._currentNumber = 200 + Math.floor(Math.random() * 800); // 200-999
      this._subtrahend = [13, 17, 19][Math.floor(Math.random() * 3)]!;
    }

    this._ruleChangeEvery = 1; // Change subtrahend every hit
    this._isAdding = false;
    this._compute_expected();
  }

  private _compute_expected(): void {
    if (this._isAdding) {
      this._expectedAnswer = this._currentNumber + this._subtrahend;
    } else {
      this._expectedAnswer = this._currentNumber - this._subtrahend;
    }
  }

  /** Check boundary and potentially flip direction (level 8+) */
  private _check_boundary(): boolean {
    if (this.config.difficulty < 8) {
      // Below level 8: stop if next subtraction would go negative
      return (this._currentNumber - this._subtrahend) >= 0;
    }

    // Level 8+: direction flip
    if (!this._isAdding && this._currentNumber - this._subtrahend < 0) {
      this._isAdding = true;
      audioEngine.play_transition();
      return true;
    }
    if (this._isAdding && this._currentNumber + this._subtrahend > 100) {
      this._isAdding = false;
      audioEngine.play_transition();
      return true;
    }
    return true;
  }

  private _start_active(): void {
    this._phase = 'active';
    this._phaseStart = precise_now();
    this._trialStartTime = precise_now();
    this._userInput = '';
    this._compute_expected();
  }

  private _advance_to_next(): void {
    // Update current number to the answer
    this._currentNumber = this._expectedAnswer;
    this._consecutiveCorrect++;
    this._chainLength++;

    // Check if subtrahend should change
    if (this._consecutiveCorrect >= this._ruleChangeEvery && this._ruleChangeEvery !== Infinity) {
      this._consecutiveCorrect = 0;
      this._change_subtrahend();
      return;
    }

    // Check boundary
    if (!this._check_boundary()) {
      this._init_arithmetic();
    }

    this._start_active();
  }

  private _change_subtrahend(): void {
    const diff = this.config.difficulty;
    const pools = diff <= 4
      ? [3, 4, 5, 6, 7]
      : diff <= 7
        ? [7, 8, 9, 11, 13, 17]
        : [13, 17, 19, 23, 29];

    // Pick a different subtrahend
    let newSub: number;
    do {
      newSub = pools[Math.floor(Math.random() * pools.length)]!;
    } while (newSub === this._subtrahend && pools.length > 1);

    // Force exact 0 if it would go negative (and we aren't in addition mode)
    if (this.config.difficulty < 8 && this._currentNumber - newSub < 0) {
      newSub = this._currentNumber;
      if (newSub === 0) {
        // If already 0, we can't continue subtracting, so reinit
        this._init_arithmetic();
        return;
      }
    }

    this._subtrahend = newSub;
    this._start_active();
    audioEngine.play_transition();
  }

  // ── Input Handling ───────────────────────────────────────

  private _on_input(event: InputEvent): void {
    if (this._phase !== 'active') return;

    this._lastInputMode = event.inputMode;

    switch (event.value) {
      case 'Enter':
        this._submit_answer();
        break;
      case 'Backspace':
        this._userInput = this._userInput.slice(0, -1);
        break;
      default:
        // Digit — max 4 characters
        if (event.value >= '0' && event.value <= '9' && this._userInput.length < 4) {
          this._userInput += event.value;
        }
        break;
    }
  }

  private _submit_answer(): void {
    if (this._userInput.length === 0) return;

    const userAnswer = parseInt(this._userInput, 10);
    const reactionMs = precise_now() - this._trialStartTime;
    const isCorrect = userAnswer === this._expectedAnswer;

    this._wasCorrect = isCorrect;

    if (!isCorrect) {
      this._feedbackText = `${this._expectedAnswer}`;
      this._consecutiveCorrect = 0;
    } else {
      this._feedbackText = '✓';
    }

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this.config.difficulty,
      isCorrect,
      reactionTimeMs: reactionMs,
      metadata: {
        trial: this.currentTrial + 1,
        startingNumber: this._currentNumber,
        subtrahend: this._subtrahend,
        expectedAnswer: this._expectedAnswer,
        userAnswer,
        inputMode: this._lastInputMode,
        subtrahendChanged: false,
        chainLength: this._chainLength,
        direction: this._isAdding ? 'add' : 'sub',
      },
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
    this._userInput = '';
  }

  // ── Numpad Geometry ──────────────────────────────────────

  private _compute_numpad_layout(): void {
    const padAreaW = this.width * 0.3;
    const padAreaH = this.height * 0.5;
    this._numpadX = this.width - padAreaW - 24;
    this._numpadY = (this.height - padAreaH) / 2 + 30;
    this._btnW = (padAreaW - this._numpadGap * 2) / 3;
    this._btnH = (padAreaH - this._numpadGap * 3) / 4;
  }

  private _hit_test_numpad(x: number, y: number): string | null {
    for (const btn of NUMPAD_LAYOUT) {
      const bx = this._numpadX + btn.col * (this._btnW + this._numpadGap);
      const by = this._numpadY + btn.row * (this._btnH + this._numpadGap);
      if (x >= bx && x <= bx + this._btnW && y >= by && y <= by + this._btnH) {
        return btn.value;
      }
    }
    return null;
  }

  // ── Scribble Animation ───────────────────────────────────

  private _generate_scribble(): void {
    const lines: typeof this._scribbleLines = [];
    const chalkX = 32;
    const chalkW = this.width * 0.6;
    const chalkY = 80;
    const chalkH = this.height - 160;
    const cx = chalkX + chalkW / 2;
    const cy = chalkY + chalkH * 0.35;
    const spread = 70; // Tighter spread

    // Generate lines for a quick "eraser" effect
    for (let i = 0; i < 25; i++) {
      const x = cx - spread/2 + Math.random() * spread;
      const y = cy - 20 + Math.random() * 40;
      
      lines.push({
        x1: x - 15 + Math.random() * 30,
        y1: y - 8 + Math.random() * 16,
        x2: x - 15 + Math.random() * 30,
        y2: y - 8 + Math.random() * 16,
      });
    }

    this._scribbleLines = lines;
  }

  // ── Render Methods ───────────────────────────────────────

  private _render_chalkboard(ctx: CanvasRenderingContext2D): void {
    const chalkX = 32;
    const chalkW = this.width * 0.6;
    const chalkY = 80;
    const chalkH = this.height - 160;

    // Chalkboard background
    ctx.fillStyle = 'hsla(225, 30%, 10%, 0.5)';
    ctx.beginPath();
    ctx.roundRect(chalkX, chalkY, chalkW, chalkH, 12);
    ctx.fill();
    ctx.strokeStyle = 'hsla(220, 20%, 25%, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const centerX = chalkX + chalkW / 2;
    const elapsed = precise_now() - this._phaseStart;

    // Fade out logic ONLY during scribble/erasure per user request
    let alpha = 1.0;
    if (this._phase === 'scribble') {
      alpha = Math.max(0, 1 - (elapsed / 600));
    }

    // Current number (large)
    ctx.font = 'bold 64px Inter, sans-serif';
    ctx.fillStyle = `hsla(220, 20%, 90%, ${alpha})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this._currentNumber), centerX, chalkY + chalkH * 0.35);

    // Operation indicator
    const opSymbol = this._isAdding ? '+' : '−';
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.fillStyle = `hsla(175, 70%, 55%, ${alpha})`;
    ctx.fillText(`${opSymbol}${this._subtrahend}`, centerX, chalkY + chalkH * 0.55);

    // Direction label for level 8+
    if (this.config.difficulty >= 8) {
      ctx.font = '400 12px Inter, sans-serif';
      ctx.fillStyle = 'hsla(175, 70%, 50%, 0.5)';
      ctx.fillText(
        this._isAdding ? 'ADDITION MODE' : 'SUBTRACTION MODE',
        centerX, chalkY + chalkH * 0.65
      );
    }
  }

  private _render_chalkboard_with_scribble(ctx: CanvasRenderingContext2D): void {
    // Render the base number which is now fading via alpha in _render_chalkboard
    this._render_chalkboard(ctx);

    const elapsed = precise_now() - this._phaseStart;
    const progress = Math.min(1, elapsed / 1000);

    ctx.strokeStyle = 'hsl(225, 45%, 6%)'; // Exact background color
    ctx.lineWidth = 14; 
    ctx.lineCap = 'round';

    const count = this._scribbleLines.length;
    for (let i = 0; i < count; i++) {
      const lineStartProgress = i / count;
      if (progress < lineStartProgress) continue;

      const line = this._scribbleLines[i]!;
      const lineLocalProgress = Math.min(1, (progress - lineStartProgress) * 4);

      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(
        line.x1 + (line.x2 - line.x1) * lineLocalProgress,
        line.y1 + (line.y2 - line.y1) * lineLocalProgress
      );
      ctx.stroke();
    }
  }

  private _render_numpad(ctx: CanvasRenderingContext2D): void {
    for (const btn of NUMPAD_LAYOUT) {
      const bx = this._numpadX + btn.col * (this._btnW + this._numpadGap);
      const by = this._numpadY + btn.row * (this._btnH + this._numpadGap);

      // Button background
      ctx.beginPath();
      ctx.roundRect(bx, by, this._btnW, this._btnH, 8);
      ctx.fillStyle = 'hsla(225, 30%, 15%, 0.6)';
      ctx.fill();
      ctx.strokeStyle = 'hsla(220, 20%, 35%, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Button label
      ctx.font = `600 ${Math.min(this._btnH * 0.4, 24)}px Inter, sans-serif`;
      ctx.fillStyle = 'hsl(220, 15%, 75%)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, bx + this._btnW / 2, by + this._btnH / 2);
    }
  }

  private _render_input_display(ctx: CanvasRenderingContext2D): void {
    // Calculator-style display bar between chalkboard and numpad
    const displayX = this._numpadX;
    const displayY = this._numpadY - 50;
    const displayW = (this._btnW + this._numpadGap) * 3 - this._numpadGap;
    const displayH = 40;

    ctx.beginPath();
    ctx.roundRect(displayX, displayY, displayW, displayH, 8);
    ctx.fillStyle = 'hsla(225, 35%, 12%, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(175, 70%, 50%, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // User input text
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.fillStyle = this._userInput.length > 0 ? 'hsl(220, 20%, 90%)' : 'hsla(220, 15%, 45%, 0.5)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      this._userInput || '?',
      displayX + displayW - 12,
      displayY + displayH / 2
    );

    // Blinking cursor
    if (Math.floor(precise_now() / 500) % 2 === 0) {
      const cursorX = displayX + displayW - 8;
      ctx.fillStyle = 'hsl(175, 70%, 55%)';
      ctx.fillRect(cursorX, displayY + 8, 2, displayH - 16);
    }
  }

  private _render_feedback(ctx: CanvasRenderingContext2D): void {
    this._render_chalkboard(ctx);

    const cx = this.width * 0.3;
    const cy = this.height * 0.75;

    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._wasCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText(`Answer: ${this._feedbackText}`, cx, cy);
    }
  }
}
