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
import { get_locale, t } from '@shared/i18n.ts';
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

  // State
  private _allWords: WordItem[] = [];
  private _usedIndices: Set<number> = new Set();
  private _currentWord: string = '';
  private _scrambled: string = '';
  private _userInput: string = '';
  private _tapHistory: number[] = []; // Tracks indices of tapped tiles for undo
  private _timeLimitMs: number = 15000;
  private _isCorrect: boolean = false;
  private _scrambledLetters: string[] = [];
  private _firstKeystrokeMs: number | null = null;
  private _usedTileIndices: Set<number> = new Set();
  private _tileRects: { x: number; y: number; w: number; h: number }[] = [];
  private _inputAreaRect: { x: number; y: number; w: number; h: number } | null = null;
  private _btnGradients: CanvasGradient[] = [];
  private _currentDefinition?: string;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phaseStart = precise_now();
    // Await data before starting the countdown UI
    this._load_data().then(() => {
      this.start_countdown(() => this._next_trial());
    }).catch(() => {
      console.error("Failed to load dictionary.");
    });
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
        // Handled by BaseEngine
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

    // Background texture
    this.draw_background_mesh(ctx, w, h);

    // HUD
    this.draw_hud(ctx, w);

    switch (this._phase) {
      case 'countdown':
        break;

      case 'playing':
        this._render_puzzle(ctx, cx, cy, w);
        break;

      case 'feedback':
        const progress = (precise_now() - this._phaseStart) / 1500;
        this.draw_feedback_orb(ctx, cx, cy, this._isCorrect, progress);
        if (!this._isCorrect) {
          ctx.font = '800 12px Outfit, sans-serif';
          ctx.fillStyle = 'hsla(0, 0%, 100%, 0.6)';
          ctx.textAlign = 'center';
          ctx.fillText(this._currentWord.toUpperCase(), cx, cy + this.lastOrbRadius + 20);
        }
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
    const isMobile = this.width < 600;
    let tileW = 42;
    let tileH = 54;
    let tileGap = 10;
    
    // Scale down for long words on mobile
    const rawTotalW = letters.length * tileW + (letters.length - 1) * tileGap;
    if (isMobile && rawTotalW > this.width - 40) {
      const scale = (this.width - 40) / rawTotalW;
      tileW *= scale;
      tileH *= scale;
      tileGap *= scale;
    }

    const totalTileW = letters.length * tileW + (letters.length - 1) * tileGap;
    const tileStartX = cx - totalTileW / 2;
    const tileY = 130;

    this._tileRects = [];

    for (let i = 0; i < letters.length; i++) {
      const tx = tileStartX + i * (tileW + tileGap);
      const isUsed = this._usedTileIndices.has(i);
      this._tileRects.push({ x: tx, y: tileY, w: tileW, h: tileH });

      ctx.save();
      if (isUsed) ctx.globalAlpha = 0.2;
      
      this.draw_glass_panel(ctx, tx, tileY, tileW, tileH, 8);
      
      if (!isUsed) {
        ctx.fillStyle = this._btnGradients[i] || 'white';
        ctx.beginPath();
        ctx.roundRect(tx + 2, tileY + 2, tileW - 4, tileH - 4, 6);
        ctx.fill();

        ctx.font = '800 22px Outfit, sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letters[i]!, tx + tileW / 2, tileY + tileH / 2);
      } else {
        ctx.strokeStyle = 'hsla(220, 20%, 30%, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, tileY, tileW, tileH);
      }
      ctx.restore();
    }

    // User input display (Target area)
    const inputY = tileY + tileH + 60;
    const inputW = Math.max(240, totalTileW + 40);
    const inputH = 54;
    this._inputAreaRect = { x: cx - inputW / 2, y: inputY, w: inputW, h: inputH };

    // HINTS
    ctx.font = '600 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    
    if (elapsed > this._timeLimitMs * 0.6 && this._currentDefinition) {
      ctx.fillStyle = 'hsla(45, 80%, 65%, 0.8)';
      const text = t('exercise.wordScramble.hintDef', { def: this._currentDefinition }).toUpperCase();
      const words = text.split(' ');
      let lines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine + word + ' ';
        if (ctx.measureText(testLine).width > this.width * 0.8 && currentLine !== '') {
          lines.push(currentLine.trim());
          currentLine = word + ' ';
        } else {
          currentLine = testLine;
        }
      }
      lines.push(currentLine.trim());
      
      let lineY = inputY - 45 - (lines.length - 1) * 14;
      for (const line of lines) {
        ctx.fillText(line, cx, lineY);
        lineY += 14;
      }
    } else if (elapsed > this._timeLimitMs * 0.8) {
      ctx.fillStyle = 'hsla(45, 80%, 60%, 0.8)';
      ctx.fillText(t('exercise.wordScramble.hintBoth', { start: this._currentWord.charAt(0), end: this._currentWord.charAt(this._currentWord.length - 1) }).toUpperCase(), cx, inputY - 45);
    } else if (elapsed > this._timeLimitMs * 0.3) {
      ctx.fillStyle = 'hsla(45, 80%, 60%, 0.7)';
      ctx.fillText(t('exercise.wordScramble.hintStart', { start: this._currentWord.charAt(0) }).toUpperCase(), cx, inputY - 45);
    }

    ctx.font = '800 10px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(get_locale() === 'es' ? 'TOCA LAS LETRAS' : 'TAP LETTERS TO BUILD', cx, inputY - 18);

    // Input area background
    this.draw_glass_panel(ctx, cx - inputW / 2, inputY, inputW, inputH, 12);
    ctx.strokeStyle = this._userInput.length > 0 ? 'hsla(175, 60%, 50%, 0.4)' : 'hsla(220, 20%, 30%, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Render current word in input area as small tiles too (for "Reactive" feel)
    const activeLetters = this._userInput.split('');
    const sTileW = 32;
    const sTileH = 40;
    const sTileGap = 4;
    const sTotalW = activeLetters.length * sTileW + (activeLetters.length - 1) * sTileGap;
    const sStartX = cx - sTotalW / 2;
    const sY = inputY + (inputH - sTileH) / 2;

    activeLetters.forEach((char, i) => {
      const tx = sStartX + i * (sTileW + sTileGap);
      this.draw_glass_panel(ctx, tx, sY, sTileW, sTileH, 6);
      ctx.strokeStyle = 'hsla(175, 60%, 50%, 0.4)';
      ctx.stroke();

      ctx.font = '800 18px Outfit, sans-serif';
      ctx.fillStyle = 'white';
      ctx.fillText(char, tx + sTileW / 2, sY + sTileH / 2);
    });

    if (this._userInput.length === 0) {
      ctx.font = '800 16px Outfit, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 40%, 0.3)';
      ctx.fillText('...', cx, inputY + inputH / 2);
    }
  }



  protected on_key_event(e: KeyboardEvent, _timestamp: number): void {
    if (this._phase !== 'playing') return;

    if (e.key === 'Enter') {
      this._submit(this._userInput.toUpperCase() === this._currentWord);
      return;
    }

    if (e.key === 'Backspace') {
      this._handle_undo(); // Route directly to existing undo logic
      return;
    }

    // Capture i18n input (letters including accents/ñ)
    if (e.key.length === 1 && e.key.match(/[a-záéíóúñ]/i)) {
      const targetChar = e.key.toUpperCase();
      
      // Find the FIRST matching letter in the rack that hasn't been used yet
      const tileIndex = this._scrambledLetters.findIndex(
        (char, idx) => char === targetChar && !this._usedTileIndices.has(idx)
      );

      if (tileIndex !== -1) {
        this._handle_rack_tap(tileIndex);
      }
    }
  }

  protected on_key_down(_code: string, _timestamp: number): void {
    // Unused, overridden by on_key_event
  }

  protected on_cleanup(): void {
    this.canvas.onpointerdown = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _next_trial(): void {
    this._usedTileIndices.clear();
    this._tapHistory = [];
    const diff = this._currentDifficulty;

    const maxDiff = diff <= 3 ? 2 : diff <= 7 ? 4 : 5;
    const minDiff = diff <= 3 ? 1 : diff <= 7 ? 2 : 3;
    let pool = this._allWords
      .map((item, idx) => ({ item, idx }))
      .filter(({ item, idx }) => item.difficulty >= minDiff && item.difficulty <= maxDiff && !this._usedIndices.has(idx));

    if (pool.length === 0) {
      this._usedIndices.clear();
      // Fallback: relax difficulty constraints if the exact band is exhausted or empty
      pool = this._allWords.map((item, idx) => ({ item, idx }));
      
      if (pool.length === 0) {
        // Failsafe if dictionary is completely empty
        this._currentWord = "ERROR";
        this._currentDefinition = "No words loaded";
      } else {
        const pick = pool[Math.floor(Math.random() * pool.length)]!;
        this._currentWord = pick.item.word;
        this._currentDefinition = pick.item.definition;
        this._usedIndices.add(pick.idx);
      }
    } else {
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      this._currentWord = pick.item.word;
      this._currentDefinition = pick.item.definition;
      this._usedIndices.add(pick.idx);
    }

    // Scramble (ensure it's actually different)
    this._scrambled = this._shuffle_word(this._currentWord);
    this._scrambledLetters = this._scrambled.split(''); // Cache to prevent allocation in render loop

    // Time limit
    if (diff <= 3) this._timeLimitMs = 15000;
    else if (diff <= 7) this._timeLimitMs = 12000;
    else this._timeLimitMs = 8000;

    this._userInput = '';
    this._tapHistory = [];
    this._firstKeystrokeMs = null;

    // Pre-compute gradients
    this._btnGradients = [];
    const tileW = 42;
    const tileH = 54;
    const tileGap = 10;
    const totalTileW = this._scrambledLetters.length * tileW + (this._scrambledLetters.length - 1) * tileGap;
    const tileStartX = (this.width / 2) - totalTileW / 2;
    const tileY = 130;

    for (let i = 0; i < this._scrambledLetters.length; i++) {
        const tx = tileStartX + i * (tileW + tileGap);
        const grad = this.ctx.createLinearGradient(tx, tileY, tx, tileY + tileH);
        grad.addColorStop(0, 'hsla(175, 70%, 55%, 0.9)');
        grad.addColorStop(1, 'hsla(175, 70%, 45%, 1.0)');
        this._btnGradients.push(grad);
    }

    this._phase = 'playing';
    this._phaseStart = precise_now();

    // Register click handler for touch interaction
    this.canvas.onpointerdown = (e: MouseEvent) => {
      if (this._phase !== 'playing') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Check Rack tiles
      for (let i = 0; i < this._tileRects.length; i++) {
        const r = this._tileRects[i]!;
        if (!this._usedTileIndices.has(i) && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          this._handle_rack_tap(i);
          return;
        }
      }

      // Check Input area (Undo)
      if (this._inputAreaRect && x >= this._inputAreaRect.x && x <= this._inputAreaRect.x + this._inputAreaRect.w && y >= this._inputAreaRect.y && y <= this._inputAreaRect.y + this._inputAreaRect.h) {
        this._handle_undo();
      }
    };
  }

  private _handle_rack_tap(index: number): void {
    const char = this._scrambledLetters[index]!;
    this._userInput += char;
    this._tapHistory.push(index);
    this._usedTileIndices.add(index);
    audioEngine.play_tick();

    if (!this._firstKeystrokeMs) this._firstKeystrokeMs = precise_now() - this._phaseStart;

    if (this._userInput.length === this._currentWord.length) {
      this._submit(this._userInput.toUpperCase() === this._currentWord);
    }
  }

  private _handle_undo(): void {
    if (this._tapHistory.length === 0) return;
    
    const lastIndex = this._tapHistory.pop()!;
    this._usedTileIndices.delete(lastIndex);
    this._userInput = this._userInput.slice(0, -1);
    audioEngine.play_tick();
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
