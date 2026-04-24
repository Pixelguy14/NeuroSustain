// ============================================================
// NeuroSustain — Fallacy Detector Engine
// Inhibitory Control + Critical Thinking
//
// Trains the brain to PAUSE and analyze argument structure
// instead of reacting emotionally to content — directly
// combating the "Go-Go-Go" pattern of social media.
//
// Mechanics:
//   - An argument appears on screen.
//   - User classifies: VALID or FALLACY.
//   - Time pressure scales with difficulty.
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { get_locale, t } from '@shared/i18n.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'countdown' | 'presenting' | 'feedback';

interface FallacyItem {
  argument: string;
  isValid: boolean;
  fallacyType: string | null;
  difficulty: number;
}

// Button geometry (computed once, reused)
const BTN_H = 56;
const BTN_GAP = 24;

export class FallacyDetectorEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'FallacyDetector';
  readonly primaryPillar: CognitivePillar = 'InhibitoryControl';
  readonly totalTrials: number = 15;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;

  private _allItems: FallacyItem[] = [];
  private _currentItem: FallacyItem | null = null;
  private _usedIndices: Set<number> = new Set(); // No-repeat within session
  private _timeLimitMs: number = 10000;
  private _isCorrect: boolean = false;

  // Button geometry
  private _btnValidX: number = 0;
  private _btnFallacyX: number = 0;
  private _btnY: number = 0;
  private _btnW: number = 0;

  // Cached text lines (Zero-Allocation: computed once per trial)
  private _wrappedLines: string[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phaseStart = precise_now();
    this.start_countdown(() => this._next_trial());

    // Load fallacy data based on locale
    this._load_data();
  }

  private async _load_data(): Promise<void> {
    const locale = get_locale();
    try {
      const module = locale === 'es'
        ? await import('../../assets/data/fallacies-es.json')
        : await import('../../assets/data/fallacies-en.json');
      this._allItems = module.default as FallacyItem[];
    } catch {
      this._allItems = [];
    }
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        // Handled by BaseEngine
        break;
      }

      case 'presenting':
        // Auto-fail if time runs out
        if (elapsed >= this._timeLimitMs) {
          this._submit_answer(null);
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
        break;

      case 'presenting':
        this._render_argument(ctx, cx, cy, w, h);
        break;

      case 'feedback':
        this._render_feedback(ctx, cx, cy);
        break;
    }
  }

  private _render_argument(ctx: CanvasRenderingContext2D, cx: number, _cy: number, w: number, h: number): void {
    const elapsed = precise_now() - this._phaseStart;

    // Time bar
    const progress = Math.min(1, elapsed / this._timeLimitMs);
    const barY = 70;
    const barW = w - 120;
    const barH = 4;
    const barX = (w - barW) / 2;

    ctx.fillStyle = 'hsla(220, 20%, 20%, 0.4)';
    ctx.fillRect(barX, barY, barW, barH);

    const hue = progress < 0.6 ? 175 : progress < 0.85 ? 45 : 0;
    ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
    ctx.fillRect(barX, barY, barW * (1 - progress), barH);

    // Argument text — use cached wrapped lines
    ctx.font = '400 17px Inter, sans-serif';
    ctx.fillStyle = 'hsl(220, 20%, 85%)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const lineHeight = 28;
    const textStartY = 100;
    for (let i = 0; i < this._wrappedLines.length; i++) {
      ctx.fillText(this._wrappedLines[i]!, cx, textStartY + i * lineHeight);
    }

    // Two buttons at bottom
    this._btnW = Math.min(200, (w - BTN_GAP * 3) / 2);
    this._btnY = h - BTN_H - 60;
    this._btnValidX = cx - this._btnW - BTN_GAP / 2;
    this._btnFallacyX = cx + BTN_GAP / 2;

    // VALID button
    ctx.beginPath();
    ctx.roundRect(this._btnValidX, this._btnY, this._btnW, BTN_H, 10);
    ctx.fillStyle = 'hsla(145, 40%, 15%, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(145, 60%, 45%, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.fillStyle = 'hsl(145, 65%, 55%)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.fallacy.valid'), this._btnValidX + this._btnW / 2, this._btnY + BTN_H / 2);

    // Keyboard hint
    ctx.font = '400 10px Inter, sans-serif';
    ctx.fillStyle = 'hsla(145, 50%, 50%, 0.5)';
    ctx.fillText('[←]', this._btnValidX + this._btnW / 2, this._btnY + BTN_H + 14);

    // FALLACY button
    ctx.beginPath();
    ctx.roundRect(this._btnFallacyX, this._btnY, this._btnW, BTN_H, 10);
    ctx.fillStyle = 'hsla(0, 40%, 15%, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(0, 60%, 45%, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.fillStyle = 'hsl(0, 65%, 55%)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.fallacy.fallacy'), this._btnFallacyX + this._btnW / 2, this._btnY + BTN_H / 2);

    ctx.font = '400 10px Inter, sans-serif';
    ctx.fillStyle = 'hsla(0, 50%, 50%, 0.5)';
    ctx.fillText('[→]', this._btnFallacyX + this._btnW / 2, this._btnY + BTN_H + 14);
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy - 20);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText('✗', cx, cy - 20);

      // Show fallacy type if wrong
      if (this._currentItem && !this._currentItem.isValid && this._currentItem.fallacyType) {
        ctx.font = '400 14px Inter, sans-serif';
        ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
        ctx.fillText(this._currentItem.fallacyType, cx, cy + 20);
      }
    }
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'presenting') return;

    if (code === 'ArrowLeft' || code === 'KeyA') {
      this._submit_answer(true); // VALID
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      this._submit_answer(false); // FALLACY
    }
  }

  protected on_cleanup(): void {
    // No bridge to destroy
  }

  // ── Logic ───────────────────────────────────────────────

  private _next_trial(): void {
    const diff = this._currentDifficulty;

    // Filter items by difficulty threshold (wider ranges for fairness)
    const maxDiff = diff <= 3 ? 3 : 5; // Low levels see easy+medium; high levels see all
    const pool = this._allItems
      .map((item, idx) => ({ item, idx }))
      .filter(({ item, idx }) => item.difficulty <= maxDiff && !this._usedIndices.has(idx));
    
    if (pool.length === 0) {
      // Exhausted pool — reset used indices and try again
      this._usedIndices.clear();
      const fullPool = this._allItems
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => item.difficulty <= maxDiff);
      const pick = fullPool[Math.floor(Math.random() * fullPool.length)];
      this._currentItem = pick?.item || null;
      if (pick) this._usedIndices.add(pick.idx);
    } else {
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      this._currentItem = pick.item;
      this._usedIndices.add(pick.idx);
    }

    // Time limit — more generous to allow reading complex paragraphs
    if (diff <= 3) this._timeLimitMs = 15000;
    else if (diff <= 7) this._timeLimitMs = 12000;
    else this._timeLimitMs = 10000;


    // Pre-wrap text for Zero-Allocation rendering
    this._wrappedLines = this._currentItem
      ? this._wrap_text(this._currentItem.argument, this.width - 120)
      : [];

    this._phase = 'presenting';
    this._phaseStart = precise_now();

    // Register click handler for buttons
    this.canvas.onclick = (e: MouseEvent) => {
      if (this._phase !== 'presenting') return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (y >= this._btnY && y <= this._btnY + BTN_H) {
        if (x >= this._btnValidX && x <= this._btnValidX + this._btnW) {
          this._submit_answer(true);
        } else if (x >= this._btnFallacyX && x <= this._btnFallacyX + this._btnW) {
          this._submit_answer(false);
        }
      }
    };
  }

  private _submit_answer(userSaidValid: boolean | null): void {
    if (!this._currentItem) return;
    
    const reactionMs = precise_now() - this._phaseStart;

    if (userSaidValid === null) {
      // Timeout
      this._isCorrect = false;
    } else {
      this._isCorrect = userSaidValid === this._currentItem.isValid;
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
        argumentIsValid: this._currentItem.isValid,
        fallacyType: this._currentItem.fallacyType,
        userSaidValid,
        timedOut: userSaidValid === null,
      }
    });

    this.canvas.onclick = null;
    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }

  /** Word-wrap text for canvas rendering */
  private _wrap_text(text: string, maxWidth: number): string[] {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = '400 17px Inter, sans-serif';

    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }
}
