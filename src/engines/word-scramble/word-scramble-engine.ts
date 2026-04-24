// ============================================================
// NeuroSustain — Word Scramble Engine
// Cognitive Flexibility + Working Memory (Linguistic)
//
// Scrambled words force the brain to mentally rotate and
// recombine letter sequences — the linguistic counterpart
// to Set Switching's visual categorization.
//
// Difficulty Scaling:
//   Lv 1-3: 5-letter words, 15s
//   Lv 4-7: 6-7 letter words, 12s
//   Lv 8-10: 8+ letter words, 8s
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { get_locale } from '@shared/i18n.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'countdown' | 'playing' | 'feedback';

interface WordItem {
  word: string;
  difficulty: number;
  definition?: string;
}

export class WordScrambleEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'WordScramble';
  readonly primaryPillar: CognitivePillar = 'CognitiveFlexibility';
  readonly totalTrials: number = 15;
  protected validReactionTimeMax: number = 20000;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;
  private _countdownValue: number = 3;

  // State
  private _allWords: WordItem[] = [];
  private _usedIndices: Set<number> = new Set();
  private _currentWord: string = '';
  private _scrambled: string = '';
  private _userInput: string = '';
  private _timeLimitMs: number = 15000;
  private _isCorrect: boolean = false;
  private _scrambledLetters: string[] = [];
  private _firstKeystrokeMs: number | null = null;
  private _currentDefinition?: string;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStart = precise_now();
    this._load_data();
  }

  private async _load_data(): Promise<void> {
    const locale = get_locale();
    try {
      const module = locale === 'es'
        ? await import('../../assets/data/words-es.json')
        : await import('../../assets/data/words-en.json');
      this._allWords = module.default as WordItem[];
    } catch {
      this._allWords = [];
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

      case 'playing':
        if (elapsed >= this._timeLimitMs) {
          this._submit(this._userInput === this._currentWord);
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
        ctx.font = 'bold 72px Inter, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(this._countdownValue), cx, cy);
        break;

      case 'playing':
        this._render_puzzle(ctx, cx, cy, w);
        break;

      case 'feedback':
        this._render_feedback(ctx, cx, cy);
        break;
    }
  }

  private _render_puzzle(ctx: CanvasRenderingContext2D, cx: number, _cy: number, w: number): void {
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

    // Scrambled word — letter tiles
    const letters = this._scrambledLetters;
    const tileW = 38;
    const tileH = 48;
    const tileGap = 6;
    const totalTileW = letters.length * tileW + (letters.length - 1) * tileGap;
    const tileStartX = cx - totalTileW / 2;
    const tileY = 120;

    for (let i = 0; i < letters.length; i++) {
      const tx = tileStartX + i * (tileW + tileGap);

      ctx.beginPath();
      ctx.roundRect(tx, tileY, tileW, tileH, 6);
      ctx.fillStyle = 'hsla(225, 30%, 15%, 0.6)';
      ctx.fill();
      ctx.strokeStyle = 'hsla(175, 60%, 40%, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 22px Inter, sans-serif';
      ctx.fillStyle = 'hsl(175, 70%, 60%)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letters[i]!, tx + tileW / 2, tileY + tileH / 2);
    }

    // User input display
    const inputY = tileY + tileH + 50;
    
    // HINTS
    ctx.font = '500 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    
    // Priority: Definition (50%) -> First+Last Letter (70%) -> First Letter (40%)
    if (elapsed > this._timeLimitMs * 0.5 && this._currentDefinition) {
      ctx.fillStyle = 'hsla(45, 80%, 65%, 0.9)';
      ctx.fillText(`Hint: ${this._currentDefinition}`, cx, inputY - 32);
    } else if (elapsed > this._timeLimitMs * 0.7) {
      ctx.fillStyle = 'hsla(45, 80%, 60%, 0.9)';
      ctx.fillText(`Hint: Starts with "${this._currentWord.charAt(0)}" and ends with "${this._currentWord.charAt(this._currentWord.length - 1)}"`, cx, inputY - 32);
    } else if (elapsed > this._timeLimitMs * 0.4) {
      ctx.fillStyle = 'hsla(45, 80%, 60%, 0.8)';
      ctx.fillText(`Hint: Starts with "${this._currentWord.charAt(0)}"`, cx, inputY - 32);
    }

    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('Type the word:', cx, inputY - 14);

    // Input field
    const inputW = Math.max(200, totalTileW);
    const inputH = 42;
    ctx.beginPath();
    ctx.roundRect(cx - inputW / 2, inputY, inputW, inputH, 8);
    ctx.fillStyle = 'hsla(225, 30%, 12%, 0.6)';
    ctx.fill();
    ctx.strokeStyle = this._userInput.length > 0
      ? 'hsla(175, 60%, 45%, 0.6)'
      : 'hsla(220, 20%, 30%, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillStyle = 'hsl(220, 20%, 85%)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._userInput || '…', cx, inputY + inputH / 2);

    // Cursor blink
    if (this._userInput.length > 0) {
      const cursorAlpha = Math.sin(elapsed / 300) > 0 ? 0.8 : 0;
      ctx.fillStyle = `hsla(175, 70%, 55%, ${cursorAlpha})`;
      const textWidth = ctx.measureText(this._userInput).width;
      ctx.fillRect(cx + textWidth / 2 + 2, inputY + 8, 2, inputH - 16);
    }
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy - 16);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText('✗', cx, cy - 16);
      ctx.font = '400 18px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
      ctx.fillText(this._currentWord, cx, cy + 24);
    }
  }

  protected on_key_event(e: KeyboardEvent, _timestamp: number): void {
    if (this._phase !== 'playing') return;

    if (e.key === 'Enter') {
      this._submit(this._userInput.toUpperCase() === this._currentWord);
      return;
    }

    if (e.key === 'Backspace') {
      this._userInput = this._userInput.slice(0, -1);
      return;
    }

    // Capture i18n input (letters including accents/ñ)
    if (e.key.length === 1 && e.key.match(/[a-záéíóúñ]/i)) {
      if (this._userInput.length < this._currentWord.length + 2) {
        this._userInput += e.key.toUpperCase();
        if (!this._firstKeystrokeMs) {
          this._firstKeystrokeMs = precise_now() - this._phaseStart;
        }
      }
    }
  }

  protected on_key_down(_code: string, _timestamp: number): void {
    // Unused, overridden by on_key_event
  }

  protected on_cleanup(): void {
    // No DOM to clean
  }

  // ── Logic ───────────────────────────────────────────────

  private _next_trial(): void {
    const diff = this._currentDifficulty;

    const maxDiff = diff <= 3 ? 2 : diff <= 7 ? 4 : 5;
    const minDiff = diff <= 3 ? 1 : diff <= 7 ? 2 : 3;
    const pool = this._allWords
      .map((item, idx) => ({ item, idx }))
      .filter(({ item, idx }) => item.difficulty >= minDiff && item.difficulty <= maxDiff && !this._usedIndices.has(idx));

    if (pool.length === 0) {
      this._usedIndices.clear();
      return this._next_trial();
    }

    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    this._currentWord = pick.item.word;
    this._currentDefinition = pick.item.definition;
    this._usedIndices.add(pick.idx);

    // Scramble (ensure it's actually different)
    this._scrambled = this._shuffle_word(this._currentWord);
    this._scrambledLetters = this._scrambled.split(''); // Cache to prevent allocation in render loop

    // Time limit
    if (diff <= 3) this._timeLimitMs = 15000;
    else if (diff <= 7) this._timeLimitMs = 12000;
    else this._timeLimitMs = 8000;

    this._userInput = '';
    this._firstKeystrokeMs = null;

    this._phase = 'playing';
    this._phaseStart = precise_now();
  }

  private _shuffle_word(word: string): string {
    const chars = word.split('');
    let shuffled: string;
    let attempts = 0;
    do {
      for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j]!, chars[i]!];
      }
      shuffled = chars.join('');
      attempts++;
    } while (shuffled === word && attempts < 10);
    return shuffled;
  }

  private _submit(correct: boolean): void {
    this._isCorrect = correct;
    const reactionMs = precise_now() - this._phaseStart;
    const finalRT = this._firstKeystrokeMs || reactionMs;

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
        word: this._currentWord,
        scrambled: this._scrambled,
        userInput: this._userInput,
        timedOut: !correct && this._userInput.toUpperCase() !== this._currentWord,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
