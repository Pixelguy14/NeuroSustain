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
import { t } from '@shared/i18n.ts';

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
  private _denomPressMs: number[] = []; // Timestamps of last press for animation

  // ── Zero-Allocation Cache (System A) ──
  private _cachedBillTotal: string = '';
  private _cachedAmountPaid: string = '';
  private _cachedChangeGoal: string = '';
  private _cachedTrayTotal: string = '';
  private _cachedDenomGradients: CanvasGradient[] = []; // Tactile gradients
  private _cachedDenomBadges: string[] = []; // Pre-computed "n left" strings
  private _cachedMismatch: string = '';      // Pre-computed "got != need"
  
  private _labelTotal: string = '';
  private _labelPaid: string = '';
  private _labelChangeDue: string = '';
  private _labelYourTray: string = '';
  private _labelClear: string = '';
  private _labelSubmit: string = '';
  private _labelHint: string = '';
  private _labelOut: string = '';

  private _feedbackScale: number = 0;
  private _feedbackOpacity: number = 0;

  private _boundPointerDown = (e: MouseEvent) => this._handle_input(e);

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._locale = get_locale() === 'es' ? 'es' : 'en';
    this._denoms = this._locale === 'es' ? MXN_DENOMINATIONS : USD_DENOMINATIONS;
    
    // Cache static labels once per session
    this._labelTotal = t('exercise.changeMaker.total');
    this._labelPaid = t('exercise.changeMaker.paid');
    this._labelChangeDue = t('exercise.changeMaker.changeDue');
    this._labelYourTray = t('exercise.changeMaker.yourTray');
    this._labelClear = t('exercise.changeMaker.clear');
    this._labelSubmit = t('exercise.changeMaker.submit');
    this._labelHint = t('exercise.changeMaker.hint');
    this._labelOut = t('exercise.changeMaker.out');

    // Register single listener for lifecycle
    this.canvas.addEventListener('pointerdown', this._boundPointerDown);
    
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

    // Background texture
    this.draw_background_mesh(ctx, w, h);

    // HUD
    this.draw_hud(ctx, w);

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
    const progressRemaining = 1 - progress;
    
    if (progress < 0.6) ctx.fillStyle = 'hsl(175, 70%, 55%)';
    else if (progress < 0.85) ctx.fillStyle = 'hsl(45, 70%, 55%)';
    else ctx.fillStyle = 'hsl(0, 70%, 55%)';
    
    ctx.fillRect(barX, barY, barW * progressRemaining, barH);

    // Transaction info
    // Transaction info (Glass panel)
    const glassY = 90;
    const glassH = 140;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx - 180, glassY, 360, glassH, 16);
    ctx.fillStyle = 'hsla(225, 30%, 15%, 0.4)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(175, 70%, 50%, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '600 11px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.5)';
    ctx.fillText(this._labelTotal, cx - 80, 110);
    ctx.fillText(this._labelPaid, cx + 80, 110);

    ctx.font = 'bold 24px Outfit, sans-serif';
    ctx.fillStyle = 'hsl(0, 75%, 65%)';
    ctx.fillText(this._cachedBillTotal, cx - 80, 135);
    ctx.fillStyle = 'hsl(145, 70%, 60%)';
    ctx.fillText(this._cachedAmountPaid, cx + 80, 135);

    // Change goal separator
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(cx - 140, 160);
    ctx.lineTo(cx + 140, 160);
    ctx.strokeStyle = 'hsla(220, 15%, 30%, 0.4)';
    ctx.stroke();
    ctx.setLineDash([]);

    // Change goal
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.5)';
    ctx.fillText(this._labelChangeDue, cx - 90, 185);
    ctx.font = 'bold 22px Outfit, sans-serif';
    ctx.fillStyle = 'hsl(45, 90%, 65%)';
    ctx.textAlign = 'left';
    ctx.fillText(this._cachedChangeGoal, cx - 40, 185);

    // Tray total
    ctx.textAlign = 'center';
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.5)';
    ctx.fillText(this._labelYourTray, cx - 90, 210);
    ctx.font = 'bold 22px Outfit, sans-serif';
    const trayColor = this._trayTotal === this._changeGoal
      ? 'hsl(145, 75%, 65%)'
      : this._trayTotal > this._changeGoal
        ? 'hsl(0, 75%, 65%)'
        : 'hsl(175, 80%, 65%)';
    ctx.fillStyle = trayColor;
    ctx.textAlign = 'left';
    ctx.fillText(this._cachedTrayTotal, cx - 40, 210);
    ctx.restore();

    // Denomination buttons
    const availDenoms = this._get_active_denoms();
    const now = precise_now();
    for (let i = 0; i < availDenoms.length; i++) {
      const denom = availDenoms[i]!;
      const r = this._denomRects[i]!;
      if (!r) continue;
      
      const pressElapsed = now - (this._denomPressMs[i] || 0);
      const pressScale = Math.max(0.92, 1 - Math.exp(-pressElapsed / 60) * 0.08);
      
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(pressScale, pressScale);
      
      const bx = -r.w / 2;
      const by = -r.h / 2;

      // Drop shadow for tactile feel
      ctx.shadowBlur = 12;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowOffsetY = 4;

      ctx.beginPath();
      if (denom.type === 'coin') {
        const radius = Math.min(r.w, r.h) / 2 - 4;
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = this._cachedDenomGradients[i]!;
        ctx.fill();
        ctx.strokeStyle = denom.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.roundRect(bx + 4, by + 4, r.w - 8, r.h - 8, 8);
        ctx.fillStyle = this._cachedDenomGradients[i]!;
        ctx.fill();
        ctx.strokeStyle = denom.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.shadowColor = 'transparent';

      // Label
      ctx.font = 'bold 13px Outfit, sans-serif';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(denom.label, 0, 0);

      // Inventory
      const total = this._trayCounts[i] || 0;
      const added = this._userCounts[i] || 0;
      const left = total - added;
      
      ctx.font = '800 9px Outfit, sans-serif';
      ctx.fillStyle = left > 0 ? 'hsla(0, 0%, 100%, 0.7)' : 'hsl(0, 80%, 70%)';
      ctx.textAlign = 'right';
      ctx.fillText(left > 0 ? this._cachedDenomBadges[i]! : this._labelOut, r.w / 2 - 8, -r.h / 2 + 12);
      
      ctx.restore();
    }

    // Submit button
    const cols = Math.min(5, availDenoms.length);
    const rows = Math.ceil(availDenoms.length / cols);
    const startY = 250;
    const subY = startY + rows * (DENOM_H + DENOM_GAP) + 16;
    const clearW = 120;
    const subW = 120;
    const gap = 12;
    const totalW = clearW + subW + gap;
    const buttonsX = cx - totalW / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.beginPath();
    ctx.roundRect(buttonsX, subY, clearW, 40, 8);
    ctx.fillStyle = this._trayTotal > 0 ? 'hsla(0, 60%, 25%, 0.6)' : 'hsla(225, 25%, 15%, 0.4)';
    ctx.fill();
    ctx.strokeStyle = this._trayTotal > 0 ? 'hsl(0, 65%, 50%)' : 'hsla(220, 20%, 30%, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    ctx.font = 'bold 12px Outfit, sans-serif';
    ctx.fillStyle = this._trayTotal > 0 ? 'hsl(0, 70%, 65%)' : 'hsla(220, 15%, 50%, 0.5)';
    ctx.fillText(this._labelClear, buttonsX + clearW / 2, subY + 20);

    // Submit Button
    ctx.beginPath();
    ctx.roundRect(buttonsX + clearW + gap, subY, subW, 40, 8);
    ctx.fillStyle = this._trayTotal === this._changeGoal
      ? 'hsla(145, 50%, 25%, 0.8)'
      : 'hsla(225, 25%, 15%, 0.4)';
    ctx.fill();
    ctx.strokeStyle = this._trayTotal === this._changeGoal
      ? 'hsl(145, 60%, 50%)'
      : 'hsla(220, 20%, 30%, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = 'bold 14px Outfit, sans-serif';
    ctx.fillStyle = this._trayTotal === this._changeGoal
      ? 'hsl(145, 65%, 55%)'
      : 'hsla(220, 15%, 50%, 0.5)';
    ctx.fillText(this._labelSubmit, buttonsX + clearW + gap + subW / 2, subY + 20);

    // Undo hint
    ctx.font = '800 9px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 50%, 0.4)';
    ctx.fillText(this._labelHint, cx, subY + 56);
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const elapsed = precise_now() - this._phaseStart;
    this._feedbackScale = Math.min(1.2, 0.8 + Math.exp(-elapsed / 150) * 0.4);
    this._feedbackOpacity = Math.min(1, elapsed / 200);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(this._feedbackScale, this._feedbackScale);
    ctx.globalAlpha = this._feedbackOpacity;

    // Glowing orb background (zero-allocation)
    ctx.beginPath();
    ctx.arc(0, 0, 120, 0, Math.PI * 2);
    const color = this._isCorrect ? 'hsl(145, 80%, 50%)' : 'hsl(0, 80%, 50%)';
    ctx.fillStyle = color;
    ctx.globalAlpha = this._feedbackOpacity * 0.15;
    ctx.fill();
    ctx.globalAlpha = this._feedbackOpacity;

    ctx.font = 'bold 48px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 80%, 60%)';
      ctx.fillText('✓', 0, -20);
      ctx.font = '600 18px Outfit, sans-serif';
      ctx.fillStyle = 'hsla(0, 0%, 100%, 0.8)';
      ctx.fillText(this._cachedChangeGoal, 0, 30);
    } else {
      ctx.fillStyle = 'hsl(0, 85%, 65%)';
      ctx.fillText('✗', 0, -20);
      ctx.font = '600 16px Outfit, sans-serif';
      ctx.fillStyle = 'hsla(0, 0%, 100%, 0.8)';
      ctx.fillText(this._cachedMismatch, 0, 30);
    }
    ctx.restore();
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
    this.canvas.removeEventListener('pointerdown', this._boundPointerDown);
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
    this._denomPressMs = [];
    this._cachedDenomGradients = [];
    this._cachedDenomBadges = [];
    
    for (let i = 0; i < activeDenoms.length; i++) {
      const denom = activeDenoms[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = startX + col * (btnW + DENOM_GAP);
      const by = startY + row * (DENOM_H + DENOM_GAP);
      this._denomRects.push({ x: bx, y: by, w: btnW, h: DENOM_H });
      this._denomPressMs.push(0);
      
      // Pre-compute Tactile Gradient
      const grad = this.ctx.createLinearGradient(bx, by, bx, by + DENOM_H);
      grad.addColorStop(0, denom.color);
      grad.addColorStop(1, denom.color.replace('%, 50%)', '%, 35%)').replace('%, 45%)', '%, 30%)'));
      this._cachedDenomGradients.push(grad);
      
      // Cache Badge
      const total = this._trayCounts[i] || 0;
      this._cachedDenomBadges.push(t('exercise.changeMaker.left', { n: total }));
    }

    // Cache Currency Strings
    this._cachedBillTotal = format_currency(this._billTotal, this._locale);
    this._cachedAmountPaid = format_currency(this._amountPaid, this._locale);
    this._cachedChangeGoal = format_currency(this._changeGoal, this._locale);
    this._cachedTrayTotal = format_currency(this._trayTotal, this._locale);
    this._cachedMismatch = t('exercise.changeMaker.mismatch', { got: this._cachedTrayTotal, need: this._cachedChangeGoal });

    this._phase = 'playing';
    this._phaseStart = precise_now();
  }

  private _handle_input(e: MouseEvent): void {
    if (this._phase !== 'playing') return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    for (let i = 0; i < this._denomRects.length; i++) {
      const r = this._denomRects[i]!;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        this._denomPressMs[i] = precise_now();
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
      const clearW = 120;
      const subW = 120;
      const gap = 12;
      const totalW = clearW + subW + gap;
      const buttonsX = cx - totalW / 2;

      if (x >= buttonsX + clearW + gap && x <= buttonsX + clearW + gap + subW) {
        this._submit(this._trayTotal === this._changeGoal);
      }
      else if (x >= buttonsX && x <= buttonsX + clearW) {
        this._clear_tray();
      }
    }
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
    
    // Update local caches
    this._cachedDenomBadges[index] = left > 0 ? t('exercise.changeMaker.left', { n: left }) : this._labelOut;
    this._cachedTrayTotal = format_currency(this._trayTotal, this._locale);
    this._cachedMismatch = t('exercise.changeMaker.mismatch', { got: this._cachedTrayTotal, need: this._cachedChangeGoal });
    
    audioEngine.play_tick();
  }

  private _undo_last(): void {
    const lastIndex = this._trayHistory.pop();
    if (lastIndex !== undefined) {
      const denoms = this._get_active_denoms();
      this._userCounts[lastIndex]!--;
      this._trayTotal -= denoms[lastIndex]!.value;
      
      // Update local caches
      const left = (this._trayCounts[lastIndex] || 0) - (this._userCounts[lastIndex] || 0);
      this._cachedDenomBadges[lastIndex] = left > 0 ? t('exercise.changeMaker.left', { n: left }) : this._labelOut;
      this._cachedTrayTotal = format_currency(this._trayTotal, this._locale);
      this._cachedMismatch = t('exercise.changeMaker.mismatch', { got: this._cachedTrayTotal, need: this._cachedChangeGoal });

      audioEngine.play_tick();
    }
  }

  private _clear_tray(): void {
    if (this._trayTotal === 0) return;
    this._trayTotal = 0;
    this._userCounts.fill(0);
    this._trayHistory.length = 0;

    // Refresh all badges
    for (let i = 0; i < this._cachedDenomBadges.length; i++) {
        const left = this._trayCounts[i] || 0;
        this._cachedDenomBadges[i] = t('exercise.changeMaker.left', { n: left });
    }
    this._cachedTrayTotal = format_currency(this._trayTotal, this._locale);
    this._cachedMismatch = t('exercise.changeMaker.mismatch', { got: this._cachedTrayTotal, need: this._cachedChangeGoal });

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

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
