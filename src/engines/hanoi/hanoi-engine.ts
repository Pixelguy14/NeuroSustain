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
import { t } from '@shared/i18n.ts';

type Phase = 'tutorial' | 'countdown' | 'playing' | 'feedback';

export class HanoiEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'TowerOfHanoi';
  readonly primaryPillar: CognitivePillar = 'SustainedAttention';
  readonly totalTrials: number = 3;

  private _phase: Phase = 'tutorial';
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
  private _discGradients: CanvasGradient[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'tutorial';
    this._phaseStart = precise_now();
    this._compute_geometry();
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

    // Background texture
    this.draw_background_mesh(ctx, w, h);

    // HUD
    this.draw_hud(ctx, w);
    this.draw_status_badge(ctx, 32, 52, `Moves: ${this._moveCount} / ${this._moveLimit}`, 'hsla(175, 70%, 50%, 0.7)', 'left');

    switch (this._phase) {
      case 'tutorial':
        this._render_tutorial(ctx);
        break;

      case 'countdown':
        break;

      case 'playing':
        this._render_pegs(ctx);
        this._render_goal_instruction(ctx);
        this._render_keyboard_hint(ctx);
        break;

      case 'feedback':
        this._render_pegs(ctx);
        const progress = (precise_now() - this._phaseStart) / 2200;
        const cy = h / 2;
        this.draw_feedback_orb(ctx, cx, cy, this._isCorrect, progress);
        if (this._feedbackMessage) {
            ctx.font = 'bold 16px Outfit, sans-serif';
            ctx.fillStyle = 'hsla(0, 0%, 100%, 0.6)';
            ctx.textAlign = 'center';
            ctx.fillText(this._feedbackMessage.toUpperCase(), cx, cy + 40);
        }
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

      // Peg pole (Glass style)
      ctx.fillStyle = isSelected
        ? 'hsla(175, 60%, 45%, 0.4)'
        : isTarget
          ? 'hsla(145, 40%, 30%, 0.3)'
          : 'hsla(220, 20%, 30%, 0.2)';
      ctx.beginPath();
      ctx.roundRect(px - 3, this._pegTopY, 6, this._pegBaseY - this._pegTopY, 3);
      ctx.fill();

      // Peg label pill
      const labelY = this._pegBaseY + 12;
      this.draw_glass_panel(ctx, px - 15, labelY, 30, 22, 6);
      ctx.font = '800 11px Outfit, sans-serif';
      ctx.fillStyle = isSelected
        ? 'hsl(175, 70%, 55%)'
        : isTarget
          ? 'hsl(145, 60%, 50%)'
          : 'hsla(220, 15%, 50%, 0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p + 1), px, labelY + 11);

      // Target marker
      if (isTarget) {
        ctx.font = '800 9px Outfit, sans-serif';
        ctx.fillStyle = 'hsl(145, 60%, 50%)';
        ctx.fillText(`★ ${t('exercise.hanoi.goal')}`, px, labelY + 34);
      }

      // Draw discs on this peg
      const stack = this._pegs[p]!;
      for (let d = 0; d < stack.length; d++) {
        const discSize = stack[d]!;
        const dw = this._disc_width(discSize);
        const dy = this._pegBaseY - (d + 1) * this._discH;
        const dx = px - dw / 2;
        
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(dx, dy + 1, dw, this._discH - 3, 6);
        ctx.fillStyle = this._discGradients[discSize - 1] || 'white';
        ctx.fill();

        // High-end depth shadow
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.stroke();
        ctx.restore();

        if (isSelected && d === stack.length - 1 && this._heldDisc > 0) {
          ctx.shadowColor = 'white';
          ctx.shadowBlur = 10;
          ctx.strokeStyle = 'white';
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Draw held disc floating above the selected peg
      if (isSelected && this._heldDisc > 0) {
        const dw = this._disc_width(this._heldDisc);
        const floatY = this._pegTopY - this._discH - 12;
        
        ctx.save();
        ctx.translate(px, floatY + this._discH / 2);
        const hoverPulse = Math.sin(precise_now() / 200) * 5;
        ctx.translate(0, hoverPulse);
        
        ctx.beginPath();
        ctx.roundRect(-dw / 2, -this._discH / 2, dw, this._discH - 3, 6);
        ctx.fillStyle = this._discGradients[this._heldDisc - 1] || 'white';
        ctx.fill();
        
        ctx.shadowColor = 'white';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** In-game goal instruction */
  private _render_goal_instruction(ctx: CanvasRenderingContext2D): void {
    const pillW = 280;
    this.draw_glass_panel(ctx, (this.width - pillW) / 2, 60, pillW, 26, 13);
    ctx.font = '800 10px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(175, 70%, 55%, 0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      t('exercise.hanoi.moveAll', { src: this._sourcePeg + 1, dst: this._targetPeg + 1 }),
      this.width / 2, 74
    );
  }

  private _render_keyboard_hint(ctx: CanvasRenderingContext2D): void {
    ctx.font = '800 9px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 50%, 0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(t('exercise.hanoi.keyboardHint'), this.width / 2, this.height - 30);
  }

  private _render_tutorial(ctx: CanvasRenderingContext2D): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const isMobile = this.width < 600;

    this.draw_glass_panel(ctx, cx - 160, cy - 100, 320, 200, 20);

    ctx.font = '800 20px Outfit, sans-serif';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText(t('exercise.hanoi.name').toUpperCase(), cx, cy - 60);

    ctx.font = '500 13px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 80%, 0.9)';
    const instr = isMobile ? t('exercise.hanoi.instructionMobile') : t('exercise.hanoi.instruction');
    const lines = instr.split('. ');
    lines.forEach((line, i) => {
        ctx.fillText(line.trim(), cx, cy - 20 + i * 20);
    });

    ctx.font = '800 11px Outfit, sans-serif';
    ctx.fillStyle = 'hsl(175, 70%, 50%)';
    ctx.fillText(isMobile ? t('exercise.nback.tapStart') : t('exercise.nback.keyStart'), cx, cy + 60);
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase === 'tutorial') {
      this._phase = 'countdown';
      this.start_countdown(() => this._init_puzzle());
      return;
    }
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
      if (this._phase === 'tutorial') {
        this._phase = 'countdown';
        this.start_countdown(() => this._init_puzzle());
        return;
      }
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

    // Pre-compute disc gradients
    this._discGradients = [];
    for (let i = 1; i <= this._numDiscs; i++) {
        const hue = (i - 1) * (360 / this._numDiscs);
        const grad = this.ctx.createLinearGradient(0, 0, 0, this._discH);
        grad.addColorStop(0, `hsl(${hue}, 70%, 60%)`);
        grad.addColorStop(1, `hsl(${hue}, 70%, 40%)`);
        this._discGradients.push(grad);
    }

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
