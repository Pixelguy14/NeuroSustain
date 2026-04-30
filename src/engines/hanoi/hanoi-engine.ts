// ============================================================
// NeuroSustain — Tower of Hanoi Engine
// Sustained Attention + Forward-Thinking
//
// Requires planning multiple steps ahead — the exact cognitive
// function that atrophies when every digital interaction
// resolves in one click.
//
// Anti-Staleness Design:
//   - Source and target pegs randomize between trials.
//   - Disc count varies within difficulty band.
//   - Auto-fail at 2.5× minimum moves prevents stalemates.
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'countdown' | 'playing' | 'feedback';

export class HanoiEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'TowerOfHanoi';
  readonly primaryPillar: CognitivePillar = 'SustainedAttention';
  readonly totalTrials: number = 3;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;

  // State
  private _numDiscs: number = 3;
  private _pegs: number[][] = [[], [], []];
  private _selectedPeg: number = -1;
  private _heldDisc: number = -1;
  private _moveCount: number = 0;
  private _minMoves: number = 7;
  private _moveLimit: number = 18; // 2.5× minMoves
  private _trialStartTime: number = 0;
  private _isCorrect: boolean = false;
  private _sourcePeg: number = 0; // Which peg discs start on
  private _targetPeg: number = 2; // Which peg is the goal
  private _feedbackMessage: string = '';

  // Geometry (computed once)
  private _pegX: number[] = [0, 0, 0];
  private _pegBaseY: number = 0;
  private _pegTopY: number = 0;
  private _discMaxW: number = 0;
  private _discH: number = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phaseStart = precise_now();
    this._compute_geometry();
    this.start_countdown(() => this._init_puzzle());
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        // Handled by BaseEngine
        break;
      }

      case 'playing':
        // Win condition
        if (this._pegs[this._targetPeg]!.length === this._numDiscs) {
          this._finish_trial(true, `✓  ${this._moveCount} moves`);
        }
        // Auto-fail at move limit
        else if (this._moveCount >= this._moveLimit) {
          this._finish_trial(false, '✗  Move limit reached');
        }
        break;

      case 'feedback':
        if (elapsed > 2200) {
          if (this.currentTrial >= this.totalTrials) return;
          this._init_puzzle();
        }
        break;
    }
  }

  protected on_render(ctx: CanvasRenderingContext2D): void {
    const w = this.width;
    const h = this.height;
    const cx = w / 2;

    ctx.fillStyle = 'hsl(225, 45%, 6%)';
    ctx.fillRect(0, 0, w, h);

    // HUD
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.currentTrial} / ${this.totalTrials}`, w - 32, 40);

    ctx.textAlign = 'left';
    ctx.fillText(`Moves: ${this._moveCount} / ${this._moveLimit}`, 32, 40);

    if (this._currentDifficulty > 1) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = 'hsla(175, 70%, 50%, 0.5)';
      ctx.textAlign = 'right';
      ctx.fillText(`LV ${this._currentDifficulty}`, w - 32, 58);
    }

    switch (this._phase) {
      case 'countdown':
        break;

      case 'playing':
        this._render_pegs(ctx);
        this._render_goal_instruction(ctx);
        this._render_keyboard_hint(ctx);
        break;

      case 'feedback':
        this._render_pegs(ctx);
        ctx.font = 'bold 28px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this._isCorrect ? 'hsl(145, 65%, 55%)' : 'hsl(0, 75%, 55%)';
        ctx.fillText(this._feedbackMessage, cx, 60);
        break;
    }
  }

  private _render_pegs(ctx: CanvasRenderingContext2D): void {
    // Draw base platform
    ctx.fillStyle = 'hsla(225, 25%, 18%, 0.6)';
    ctx.fillRect(40, this._pegBaseY, this.width - 80, 6);

    for (let p = 0; p < 3; p++) {
      const px = this._pegX[p]!;
      const isTarget = p === this._targetPeg;
      const isSelected = p === this._selectedPeg;

      // Peg pole
      ctx.fillStyle = isSelected
        ? 'hsla(175, 60%, 45%, 0.6)'
        : isTarget
          ? 'hsla(145, 40%, 30%, 0.5)'
          : 'hsla(220, 20%, 30%, 0.5)';
      ctx.fillRect(px - 3, this._pegTopY, 6, this._pegBaseY - this._pegTopY);

      // Peg label
      ctx.font = 'bold 14px Inter, sans-serif';
      ctx.fillStyle = isSelected
        ? 'hsl(175, 70%, 55%)'
        : isTarget
          ? 'hsl(145, 60%, 50%)'
          : 'hsla(220, 15%, 50%, 0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(p + 1), px, this._pegBaseY + 12);

      // Target marker (star below the peg number)
      if (isTarget) {
        ctx.font = '400 11px Inter, sans-serif';
        ctx.fillStyle = 'hsl(145, 60%, 50%)';
        ctx.fillText('★ GOAL', px, this._pegBaseY + 28);
      }

      // Draw discs on this peg
      const stack = this._pegs[p]!;
      for (let d = 0; d < stack.length; d++) {
        const discSize = stack[d]!;
        const dw = this._disc_width(discSize);
        const dy = this._pegBaseY - (d + 1) * this._discH;
        const dx = px - dw / 2;
        const hue = (discSize - 1) * (360 / this._numDiscs);

        ctx.beginPath();
        ctx.roundRect(dx, dy, dw, this._discH - 2, 6);
        ctx.fillStyle = `hsl(${hue}, 65%, 55%)`;
        ctx.fill();

        if (isSelected && d === stack.length - 1 && this._heldDisc > 0) {
          ctx.shadowColor = `hsl(${hue}, 65%, 55%)`;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Draw held disc floating above the selected peg
      if (isSelected && this._heldDisc > 0) {
        const dw = this._disc_width(this._heldDisc);
        const floatY = this._pegTopY - this._discH - 8;
        const hue = (this._heldDisc - 1) * (360 / this._numDiscs);

        ctx.beginPath();
        ctx.roundRect(px - dw / 2, floatY, dw, this._discH - 2, 6);
        ctx.fillStyle = `hsl(${hue}, 65%, 55%)`;
        ctx.fill();
        ctx.shadowColor = `hsl(${hue}, 65%, 55%)`;
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  /** In-game goal instruction */
  private _render_goal_instruction(ctx: CanvasRenderingContext2D): void {
    ctx.font = '500 13px Inter, sans-serif';
    ctx.fillStyle = 'hsla(175, 70%, 55%, 0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Move all discs from Peg ${this._sourcePeg + 1} → Peg ${this._targetPeg + 1}`,
      this.width / 2, 65
    );
  }

  private _render_keyboard_hint(ctx: CanvasRenderingContext2D): void {
    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 50%, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('Press 1, 2, or 3 to select a peg', this.width / 2, this.height - 30);
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'playing') return;

    let pegIndex = -1;
    if (code === 'Digit1' || code === 'Numpad1') pegIndex = 0;
    else if (code === 'Digit2' || code === 'Numpad2') pegIndex = 1;
    else if (code === 'Digit3' || code === 'Numpad3') pegIndex = 2;

    if (pegIndex >= 0) {
      this._handle_peg_select(pegIndex);
    }
  }

  protected on_cleanup(): void {
    this.canvas.onpointerdown = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _compute_geometry(): void {
    const w = this.width;
    const h = this.height;
    const third = w / 3;

    this._pegX = [third * 0.5, third * 1.5, third * 2.5];
    this._pegBaseY = h * 0.75;
    this._pegTopY = h * 0.2;
    this._discMaxW = third * 0.85;
    this._discH = Math.min(32, (this._pegBaseY - this._pegTopY) / 8);

    this.canvas.onpointerdown = (e: MouseEvent) => {
      if (this._phase !== 'playing') return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const third = this.width / 3;

      const pegIndex = Math.floor(x / third);
      if (pegIndex >= 0 && pegIndex < 3) {
        this._handle_peg_select(pegIndex);
      }
    };
  }

  private _init_puzzle(): void {
    const diff = this._currentDifficulty;

    // Vary disc count within the difficulty band
    if (diff <= 3) {
      this._numDiscs = 3;
    } else if (diff <= 7) {
      this._numDiscs = 3 + (this.currentTrial % 2); // Alternate 3 and 4
    } else {
      this._numDiscs = 4 + (this.currentTrial % 2); // Alternate 4 and 5
    }

    this._minMoves = Math.pow(2, this._numDiscs) - 1;
    this._moveLimit = Math.ceil(this._minMoves * 2.5);
    this._moveCount = 0;
    this._selectedPeg = -1;
    this._heldDisc = -1;

    // Randomize source and target pegs (anti-staleness)
    const allPegs = [0, 1, 2];
    this._sourcePeg = allPegs[Math.floor(Math.random() * 3)]!;
    const remaining = allPegs.filter(p => p !== this._sourcePeg);
    this._targetPeg = remaining[Math.floor(Math.random() * remaining.length)]!;

    this._pegs = [[], [], []];
    for (let i = this._numDiscs; i >= 1; i--) {
      this._pegs[this._sourcePeg]!.push(i);
    }

    this._trialStartTime = precise_now();
    this._phase = 'playing';
    this._phaseStart = precise_now();
  }

  private _handle_peg_select(pegIndex: number): void {
    if (this._selectedPeg === -1) {
      const stack = this._pegs[pegIndex]!;
      if (stack.length === 0) return;

      this._selectedPeg = pegIndex;
      this._heldDisc = stack[stack.length - 1]!;
      audioEngine.play_tick();
    } else {
      if (pegIndex === this._selectedPeg) {
        this._selectedPeg = -1;
        this._heldDisc = -1;
        return;
      }

      const targetStack = this._pegs[pegIndex]!;
      const topDisc = targetStack.length > 0 ? targetStack[targetStack.length - 1]! : Infinity;

      if (this._heldDisc > topDisc) {
        audioEngine.play_error();
        this._selectedPeg = -1;
        this._heldDisc = -1;
        return;
      }

      this._pegs[this._selectedPeg]!.pop();
      targetStack.push(this._heldDisc);
      this._moveCount++;
      this._selectedPeg = -1;
      this._heldDisc = -1;
      audioEngine.play_tick();
    }
  }

  private _finish_trial(withinLimit: boolean, message: string): void {
    this._isCorrect = withinLimit;
    this._feedbackMessage = message;
    const totalTimeMs = precise_now() - this._trialStartTime;

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect: withinLimit,
      reactionTimeMs: totalTimeMs / 1000, // Normalize to seconds for display
      metadata: {
        trial: this.currentTrial + 1,
        numDiscs: this._numDiscs,
        moveCount: this._moveCount,
        minMoves: this._minMoves,
        moveLimit: this._moveLimit,
        efficiency: Math.round((this._minMoves / Math.max(1, this._moveCount)) * 100),
        sourcePeg: this._sourcePeg + 1,
        targetPeg: this._targetPeg + 1,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }

  private _disc_width(discSize: number): number {
    const minW = 30;
    const ratio = discSize / this._numDiscs;
    return minW + ratio * (this._discMaxW - minW);
  }
}
