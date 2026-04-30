// ============================================================
// NeuroSustain — Change Maker Engine
// Cognitive Flexibility + Arithmetic Working Memory
//
// Trains rapid mental arithmetic under time pressure using
// real-world currency denominations. All internal math uses
// integer centavos/cents to prevent floating-point errors.
//
// Accepts ANY valid combination (not greedy).
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { get_locale } from '@shared/i18n.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import {
  USD_DENOMINATIONS, MXN_DENOMINATIONS,
  format_currency,
  type Denomination,
} from './currencies.ts';

type Phase = 'countdown' | 'playing' | 'feedback';

const DENOM_H = 44;
const DENOM_GAP = 8;

export class ChangeMakerEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'ChangeMaker';
  readonly primaryPillar: CognitivePillar = 'CognitiveFlexibility';
  readonly totalTrials: number = 12;
  protected validReactionTimeMax: number = 30000;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;

  // Currency
  private _denoms: Denomination[] = [];
  private _locale: 'en' | 'es' = 'en';

  // Trial state
  private _billTotal: number = 0;   // cents
  private _amountPaid: number = 0;  // cents
  private _changeGoal: number = 0;  // cents (amountPaid - billTotal)
  private _trayTotal: number = 0;   // cents accumulated by user
  private _trayCounts: number[] = []; // Available inventory per denomination
  private _userCounts: number[] = []; // What user has actually added
  private _timeLimitMs: number = 20000;
  private _isCorrect: boolean = false;

  private _trayHistory: number[] = []; // Chronological history of added denominations
  private _firstMoveMs: number | null = null;

  // Denomination button geometry (computed once per trial)
  private _denomRects: { x: number; y: number; w: number; h: number }[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._locale = get_locale() === 'es' ? 'es' : 'en';
    this._denoms = this._locale === 'es' ? MXN_DENOMINATIONS : USD_DENOMINATIONS;
    this._phaseStart = precise_now();
    this.start_countdown(() => this._next_trial());
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        // Handled by BaseEngine
        break;
      }

      case 'playing':
        if (elapsed >= this._timeLimitMs) {
          this._submit(this._trayTotal === this._changeGoal);
        }
        break;

      case 'feedback':
        if (elapsed > 1500) {
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
        break;

      case 'playing':
        this._render_transaction(ctx, cx, w);
        break;

      case 'feedback':
        this._render_feedback(ctx, cx, cy);
        break;
    }
  }

  private _render_transaction(ctx: CanvasRenderingContext2D, cx: number, w: number): void {
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

    // Transaction info
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '400 13px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.7)';
    ctx.fillText('TOTAL', cx - 80, 95);
    ctx.fillText('PAID', cx + 80, 95);

    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.fillStyle = 'hsl(0, 65%, 55%)';
    ctx.fillText(format_currency(this._billTotal, this._locale), cx - 80, 120);
    ctx.fillStyle = 'hsl(145, 60%, 55%)';
    ctx.fillText(format_currency(this._amountPaid, this._locale), cx + 80, 120);

    // Change goal
    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
    ctx.fillText('CHANGE DUE', cx, 148);
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillStyle = 'hsl(45, 80%, 60%)';
    ctx.fillText(format_currency(this._changeGoal, this._locale), cx, 170);

    // Tray total (user's accumulated change)
    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
    ctx.fillText('YOUR TRAY', cx, 196);
    ctx.font = 'bold 18px Inter, sans-serif';
    const trayColor = this._trayTotal === this._changeGoal
      ? 'hsl(145, 65%, 55%)'
      : this._trayTotal > this._changeGoal
        ? 'hsl(0, 65%, 55%)'
        : 'hsl(175, 70%, 55%)';
    ctx.fillStyle = trayColor;
    ctx.fillText(format_currency(this._trayTotal, this._locale), cx, 218);

    // Denomination buttons (scrollable area)
    const availDenoms = this._get_active_denoms();
    for (let i = 0; i < availDenoms.length; i++) {
      const denom = availDenoms[i]!;
      const r = this._denomRects[i]!;
      if (!r) continue;
      
      const { x: bx, y: by, w: btnW, h: denomH } = r;

      // Token visual
      ctx.beginPath();
      if (denom.type === 'coin') {
        // Circle for coins
        const radius = Math.min(btnW, denomH) / 2 - 4;
        ctx.arc(bx + btnW / 2, by + denomH / 2, radius, 0, Math.PI * 2);
        ctx.fillStyle = denom.color.replace(')', ', 0.3)').replace('hsl', 'hsla');
        ctx.fill();
        ctx.strokeStyle = denom.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // Rounded rect for bills
        ctx.roundRect(bx + 4, by + 4, btnW - 8, denomH - 8, 6);
        ctx.fillStyle = denom.color.replace(')', ', 0.2)').replace('hsl', 'hsla');
        ctx.fill();
        ctx.strokeStyle = denom.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Label
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.fillStyle = denom.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(denom.label, bx + btnW / 2, by + denomH / 2);

      // Inventory remaining badge
      const total = this._trayCounts[i] || 0;
      const added = this._userCounts[i] || 0;
      const left = total - added;
      
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.fillStyle = left > 0 ? 'hsla(220, 15%, 55%, 0.8)' : 'hsl(0, 65%, 55%)';
      ctx.textAlign = 'right';
      ctx.fillText(left > 0 ? `${left} left` : 'OUT', bx + btnW - 6, by + 12);
    }

    // Submit button
    const cols = Math.min(5, availDenoms.length);
    const rows = Math.ceil(availDenoms.length / cols);
    const startY = 250;
    const subY = startY + rows * (DENOM_H + DENOM_GAP) + 16;
    const subW = 100;
    
    // Clear Tray Button
    const clearW = 90;
    ctx.beginPath();
    ctx.roundRect(cx - subW / 2 - clearW - 10, subY, clearW, 40, 8);
    ctx.fillStyle = this._trayTotal > 0 ? 'hsla(0, 60%, 25%, 0.6)' : 'hsla(225, 25%, 15%, 0.4)';
    ctx.fill();
    ctx.strokeStyle = this._trayTotal > 0 ? 'hsl(0, 65%, 50%)' : 'hsla(220, 20%, 30%, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = this._trayTotal > 0 ? 'hsl(0, 70%, 65%)' : 'hsla(220, 15%, 50%, 0.5)';
    ctx.fillText('✕ Clear', cx - subW / 2 - clearW / 2 - 10, subY + 20);

    // Submit Button
    ctx.beginPath();
    ctx.roundRect(cx - subW / 2 + clearW / 2 + 5, subY, subW, 40, 8);
    ctx.fillStyle = this._trayTotal === this._changeGoal
      ? 'hsla(145, 50%, 25%, 0.8)'
      : 'hsla(225, 25%, 15%, 0.4)';
    ctx.fill();
    ctx.strokeStyle = this._trayTotal === this._changeGoal
      ? 'hsl(145, 60%, 50%)'
      : 'hsla(220, 20%, 30%, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillStyle = this._trayTotal === this._changeGoal
      ? 'hsl(145, 65%, 55%)'
      : 'hsla(220, 15%, 50%, 0.5)';
    ctx.fillText('✓ Submit', cx + clearW / 2 + 5, subY + 20);

    // Undo hint
    ctx.font = '400 10px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 50%, 0.4)';
    ctx.fillText('[Backspace] Undo  ·  [C] Clear  ·  [Enter] Submit', cx, subY + 56);
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy - 16);
      ctx.font = '400 16px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
      ctx.fillText(format_currency(this._changeGoal, this._locale), cx, cy + 20);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText('✗', cx, cy - 16);
      ctx.font = '400 14px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
      ctx.fillText(
        `${format_currency(this._trayTotal, this._locale)} ≠ ${format_currency(this._changeGoal, this._locale)}`,
        cx, cy + 20
      );
    }
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'playing') return;

    if (code === 'Enter') {
      this._submit(this._trayTotal === this._changeGoal);
      return;
    }

    if (code === 'Backspace') {
      this._undo_last();
      return;
    }

    if (code === 'KeyC') {
      this._clear_tray();
      return;
    }

    // Number keys 1-9 map to denomination index
    const numMatch = code.match(/^(?:Digit|Numpad)(\d)$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1]!, 10) - 1;
      if (idx >= 0 && idx < this._get_active_denoms().length) {
        this._add_denomination(idx);
      }
    }
  }

  protected on_cleanup(): void {
    this.canvas.onpointerdown = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _get_active_denoms(): Denomination[] {
    const diff = this._currentDifficulty;
    if (this._locale === 'es') {
      // MXN: low levels = bills only, high = coins + bills
      if (diff <= 3) return this._denoms.filter(d => d.value >= 2000);
      if (diff <= 7) return this._denoms.filter(d => d.value >= 100);
      return this._denoms;
    } else {
      // USD
      if (diff <= 3) return this._denoms.filter(d => d.value >= 100);
      if (diff <= 7) return this._denoms.filter(d => d.value >= 5);
      return this._denoms;
    }
  }

  private _next_trial(): void {
    const diff = this._currentDifficulty;

    // Generate change goal first (in valid denomination units)
    const activeDenoms = this._get_active_denoms();
    
    // Instead of infinite money, we give a LIMITED inventory
    // 1. Generate a "perfect" change solution first
    let generatedChange = 0;
    this._trayCounts = new Array(activeDenoms.length).fill(0); // This will hold the INVENTORY
    
    // Pick 3-6 random denominations to build the "goal"
    const targetSteps = diff <= 3 ? 3 : diff <= 7 ? 4 : 6;
    for (let i = 0; i < targetSteps; i++) {
      const idx = Math.floor(Math.pow(Math.random(), 2) * activeDenoms.length);
      const val = activeDenoms[idx]!.value;
      generatedChange += val;
      this._trayCounts[idx] = (this._trayCounts[idx] || 0) + 1;
    }
    
    // 2. Add some "distractor" inventory (2-4 extra items)
    const distractors = diff <= 3 ? 2 : 4;
    for (let i = 0; i < distractors; i++) {
      const idx = Math.floor(Math.random() * activeDenoms.length);
      this._trayCounts[idx] = (this._trayCounts[idx] || 0) + 1;
    }

    this._changeGoal = generatedChange;

    // Bill total and amount paid
    const minUnit = activeDenoms[activeDenoms.length - 1]?.value || 1;
    this._billTotal = (5 + Math.floor(Math.random() * 50)) * minUnit + Math.floor(Math.random() * 20) * minUnit;
    this._amountPaid = this._billTotal + this._changeGoal;

    // Time limit
    if (diff <= 3) this._timeLimitMs = 25000;
    else if (diff <= 7) this._timeLimitMs = 18000;
    else this._timeLimitMs = 12000;

    // Reset user state
    this._trayTotal = 0;
    this._userCounts = new Array(activeDenoms.length).fill(0); // Tracks what user ADDED
    this._trayHistory = [];
    this._firstMoveMs = null;

    // Precompute geometry
    const cx = this.width / 2;
    const cols = Math.min(5, activeDenoms.length);
    const btnW = Math.min(90, (this.width - DENOM_GAP * (cols + 1)) / cols);
    const totalW = cols * btnW + (cols - 1) * DENOM_GAP;
    const startX = cx - totalW / 2;
    const startY = 250;

    this._denomRects = [];
    for (let i = 0; i < activeDenoms.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = startX + col * (btnW + DENOM_GAP);
      const by = startY + row * (DENOM_H + DENOM_GAP);
      this._denomRects.push({ x: bx, y: by, w: btnW, h: DENOM_H });
    }

    // Register click handler
    this.canvas.onpointerdown = (e: MouseEvent) => {
      if (this._phase !== 'playing') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      for (let i = 0; i < this._denomRects.length; i++) {
        const r = this._denomRects[i]!;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          this._add_denomination(i);
          return;
        }
      }

      const cx = this.width / 2;
      const activeDenoms = this._get_active_denoms();
      const cols = Math.min(5, activeDenoms.length);
      const rows = Math.ceil(activeDenoms.length / cols);
      const subY = 250 + rows * (DENOM_H + DENOM_GAP) + 16;
      
      if (y >= subY && y <= subY + 40) {
        const subW = 100;
        const clearW = 90;
        if (x >= cx - subW / 2 + clearW / 2 + 5 && x <= cx + subW / 2 + clearW / 2 + 5) {
          this._submit(this._trayTotal === this._changeGoal);
        }
        else if (x >= cx - subW / 2 - clearW - 10 && x <= cx - subW / 2 - 10) {
          this._clear_tray();
        }
      }
    };

    this._phase = 'playing';
    this._phaseStart = precise_now();
  }

  private _add_denomination(index: number): void {
    const denoms = this._get_active_denoms();
    const denom = denoms[index];
    if (!denom) return;

    // CHECK INVENTORY
    const left = (this._trayCounts[index] || 0) - (this._userCounts[index] || 0);
    if (left <= 0) {
      audioEngine.play_error();
      return;
    }

    this._trayTotal += denom.value;
    this._userCounts[index] = (this._userCounts[index] || 0) + 1;
    this._trayHistory.push(index);
    if (!this._firstMoveMs) this._firstMoveMs = precise_now() - this._phaseStart;
    
    audioEngine.play_tick();
  }

  private _undo_last(): void {
    const lastIndex = this._trayHistory.pop();
    if (lastIndex !== undefined) {
      const denoms = this._get_active_denoms();
      this._userCounts[lastIndex]!--;
      this._trayTotal -= denoms[lastIndex]!.value;
      audioEngine.play_tick();
    }
  }

  private _clear_tray(): void {
    if (this._trayTotal === 0) return;
    this._trayTotal = 0;
    this._userCounts = new Array(this._get_active_denoms().length).fill(0) as number[];
    this._trayHistory = [];
    audioEngine.play_tick();
  }

  private _submit(correct: boolean): void {
    this._isCorrect = correct;
    const reactionMs = precise_now() - this._phaseStart;
    const finalRT = this._firstMoveMs || reactionMs;

    if (correct) {
      audioEngine.play_correct();
    } else {
      audioEngine.play_error();
    }

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect: correct,
      reactionTimeMs: finalRT,
      metadata: {
        trial: this.currentTrial + 1,
        billTotal: this._billTotal,
        amountPaid: this._amountPaid,
        changeGoal: this._changeGoal,
        trayTotal: this._trayTotal,
        locale: this._locale,
        timedOut: !correct && this._trayTotal !== this._changeGoal,
      }
    });

    this.canvas.onpointerdown = null;
    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
