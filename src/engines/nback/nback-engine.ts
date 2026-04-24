// ============================================================
// NeuroSustain — N-Back Dual Engine
// Working Memory — The Gold Standard
//
// Trains the ability to hold and update information in working
// memory. The user must track BOTH position and audio stimuli
// across a sliding window of N trials.
//
// Progressive Loading (Clinical Protocol):
//   Lv 1-3: Single N-Back (position only), 1-Back
//   Lv 4-5: Dual N-Back (position + audio), 1-Back
//   Lv 6-7: Dual N-Back, 2-Back
//   Lv 8-10: Dual N-Back, 3-Back
//
// Zero-Allocation: Circular buffer overwrites by index.
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'tutorial' | 'countdown' | 'stimulus' | 'response' | 'feedback' | 'done';

interface Stimulus {
  position: number; // 0-8 on a 3x3 grid
  soundIndex: number; // 0-7 for spoken letters
}

// Grid constants
const GRID_SIZE = 3;
const CELL_GAP = 8;

export class NBackEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'NBackDual';
  readonly primaryPillar: CognitivePillar = 'WorkingMemory';
  readonly totalTrials: number = 25;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;
  private _countdownValue: number = 3;

  // N-Back parameters
  private _n: number = 1;
  private _isDual: boolean = false;
  private _stimulusDurationMs: number = 2000;
  private _interStimulusMs: number = 500;

  // Circular buffer (Zero-Allocation: overwrite by index)
  private _buffer: Stimulus[] = [];
  private _bufferIndex: number = 0;  // Current write position
  private _trialNumber: number = 0;  // Total stimuli shown

  // Current trial state
  private _currentStimulus: Stimulus = { position: 0, soundIndex: 0 };
  private _positionMatch: boolean = false;
  private _audioMatch: boolean = false;
  private _userPressedL: boolean = false; // Position match key
  private _userPressedA: boolean = false; // Audio match key
  private _firstReactionMs: number | null = null;

  // Feedback
  private _feedbackMsg: string = '';
  private _feedbackColor: string = '';

  // Grid geometry (computed once)
  private _gridX: number = 0;
  private _gridY: number = 0;
  private _cellSize: number = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    // Only show tutorial on trial 1 (first run of the session)
    this._phase = 'tutorial';
    this._phaseStart = precise_now();
    this._countdownValue = 3;
    this._configure_difficulty();
    this._compute_grid_geometry();

    // Initialize buffer with empty stimuli (Zero-Allocation)
    this._buffer = Array.from({ length: this._n }, () => ({ position: -1, soundIndex: -1 }));
    this._bufferIndex = 0;
    this._trialNumber = 0;
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'tutorial': {
        if (elapsed > 8000) {
          this._phase = 'countdown';
          this._phaseStart = precise_now();
        }
        break;
      }

      case 'countdown': {
        const v = 3 - Math.floor(elapsed / 800);
        if (v <= 0) {
          this._present_stimulus();
        } else {
          this._countdownValue = v;
        }
        break;
      }

      case 'stimulus':
        // Stimulus visible for _stimulusDurationMs, then enter response window
        if (elapsed >= this._stimulusDurationMs) {
          this._evaluate_response();
        }
        break;

      case 'response':
        // Brief ISI before next stimulus
        if (elapsed >= this._interStimulusMs) {
          if (this.currentTrial >= this.totalTrials) {
            this._phase = 'done';
            return;
          }
          this._present_stimulus();
        }
        break;

      case 'feedback':
        if (elapsed >= 600) {
          if (this.currentTrial >= this.totalTrials) {
            this._phase = 'done';
            return;
          }
          this._present_stimulus();
        }
        break;

      case 'done':
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

    // N-Back level indicator
    ctx.textAlign = 'left';
    ctx.fillStyle = 'hsla(175, 70%, 50%, 0.7)';
    ctx.fillText(`${this._n}-Back${this._isDual ? ' Dual' : ''}`, 32, 40);

    if (this._currentDifficulty > 1) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = 'hsla(175, 70%, 50%, 0.5)';
      ctx.textAlign = 'right';
      ctx.fillText(`LV ${this._currentDifficulty}`, w - 32, 58);
    }

    switch (this._phase) {
      case 'tutorial': {
        ctx.fillStyle = 'hsla(225, 45%, 12%, 0.9)';
        ctx.fillRect(cx - 240, cy - 140, 480, 280);
        
        ctx.font = 'bold 24px Inter, sans-serif';
        ctx.fillStyle = 'hsl(220, 20%, 90%)';
        ctx.textAlign = 'center';
        ctx.fillText('N-Back Tutorial', cx, cy - 80);

        ctx.font = '400 15px Inter, sans-serif';
        ctx.fillStyle = 'hsla(220, 15%, 70%, 0.9)';
        const textY = cy - 30;
        const nText = this._n === 1 ? 'the previous step' : `${this._n} steps ago`;
        
        if (this._isDual) {
          ctx.fillText(`Press [L] if the POSITION matches ${nText}.`, cx, textY);
          ctx.fillText(`Press [A] if the TONE matches ${nText}.`, cx, textY + 30);
          ctx.fillText(`Both can match at the same time.`, cx, textY + 60);
        } else {
          ctx.fillText(`Press [L] if the square's POSITION`, cx, textY);
          ctx.fillText(`matches the position from ${nText}.`, cx, textY + 25);
        }

        ctx.font = '500 13px Inter, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.fillText('Press ANY KEY to start...', cx, cy + 100);
        break;
      }

      case 'countdown':
        ctx.font = 'bold 72px Inter, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(this._countdownValue), cx, cy);
        break;

      case 'stimulus':
        this._render_grid(ctx, true);
        this._render_controls(ctx);
        break;

      case 'response':
        this._render_grid(ctx, false);
        // Show brief feedback inline
        if (this._feedbackMsg) {
          ctx.font = 'bold 16px Inter, sans-serif';
          ctx.fillStyle = this._feedbackColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(this._feedbackMsg, cx, this._gridY - 30);
        }
        this._render_controls(ctx);
        break;

      case 'feedback':
        this._render_grid(ctx, false);
        ctx.font = 'bold 18px Inter, sans-serif';
        ctx.fillStyle = this._feedbackColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._feedbackMsg, cx, this._gridY - 30);
        break;

      case 'done':
        break;
    }
  }

  private _render_grid(ctx: CanvasRenderingContext2D, showHighlight: boolean): void {
    // Permanent HUD instruction
    const cx = this.width / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.8)';
    ctx.font = '400 13px Inter, sans-serif';
    const nText = this._n === 1 ? '1 step' : `${this._n} steps`;
    if (this._isDual) {
      ctx.fillText(`Match Position & Sound ${nText} back`, cx, this._gridY - 20);
    } else {
      ctx.fillText(`Match Position ${nText} back`, cx, this._gridY - 20);
    }

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const i = row * GRID_SIZE + col;
        const x = this._gridX + col * (this._cellSize + CELL_GAP);
        const y = this._gridY + row * (this._cellSize + CELL_GAP);

        ctx.beginPath();
        ctx.roundRect(x, y, this._cellSize, this._cellSize, 6);

        if (showHighlight && i === this._currentStimulus.position) {
          // Active cell
          ctx.fillStyle = 'hsl(175, 70%, 50%)';
          ctx.fill();
          ctx.shadowColor = 'hsl(175, 70%, 50%)';
          ctx.shadowBlur = 20;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          // Inactive cell
          ctx.fillStyle = 'hsla(225, 25%, 15%, 0.5)';
          ctx.fill();
          ctx.strokeStyle = 'hsla(220, 20%, 30%, 0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  private _render_controls(ctx: CanvasRenderingContext2D): void {
    const y = this._gridY + GRID_SIZE * (this._cellSize + CELL_GAP) + 30;
    const cx = this.width / 2;

    ctx.font = '500 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Position match key (L)
    const lx = cx - 80;
    ctx.beginPath();
    ctx.roundRect(lx - 50, y, 100, 40, 8);
    ctx.fillStyle = this._userPressedL
      ? 'hsla(175, 60%, 30%, 0.8)'
      : 'hsla(225, 25%, 15%, 0.5)';
    ctx.fill();
    ctx.strokeStyle = this._userPressedL
      ? 'hsl(175, 70%, 50%)'
      : 'hsla(220, 20%, 30%, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'hsl(175, 70%, 55%)';
    ctx.fillText('[L] Position', lx, y + 20);

    if (this._isDual) {
      // Audio match key (A)
      const ax = cx + 80;
      ctx.beginPath();
      ctx.roundRect(ax - 50, y, 100, 40, 8);
      ctx.fillStyle = this._userPressedA
        ? 'hsla(280, 60%, 30%, 0.8)'
        : 'hsla(225, 25%, 15%, 0.5)';
      ctx.fill();
      ctx.strokeStyle = this._userPressedA
        ? 'hsl(280, 60%, 55%)'
        : 'hsla(220, 20%, 30%, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'hsl(280, 60%, 60%)';
      ctx.fillText('[A] Audio', ax, y + 20);
    }
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase === 'tutorial') {
      this._phase = 'countdown';
      this._phaseStart = precise_now();
      return;
    }

    if (this._phase !== 'stimulus') return;

    if (code === 'KeyL') {
      if (!this._userPressedL) {
        this._userPressedL = true;
        if (!this._firstReactionMs) this._firstReactionMs = precise_now() - this._phaseStart;
      }
    } else if (code === 'KeyA' && this._isDual) {
      if (!this._userPressedA) {
        this._userPressedA = true;
        if (!this._firstReactionMs) this._firstReactionMs = precise_now() - this._phaseStart;
      }
    }
  }

  protected on_cleanup(): void {
    this.canvas.onclick = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _configure_difficulty(): void {
    const diff = this._currentDifficulty;

    if (diff <= 3) {
      this._n = 1;
      this._isDual = false; // Single N-Back (position only)
      this._stimulusDurationMs = 2500;
      this._interStimulusMs = 500;
    } else if (diff <= 5) {
      this._n = 1;
      this._isDual = true; // Dual 1-Back
      this._stimulusDurationMs = 2500;
      this._interStimulusMs = 500;
    } else if (diff <= 7) {
      this._n = 2;
      this._isDual = true; // Dual 2-Back
      this._stimulusDurationMs = 2000;
      this._interStimulusMs = 500;
    } else {
      this._n = 3;
      this._isDual = true; // Dual 3-Back
      this._stimulusDurationMs = 2000;
      this._interStimulusMs = 400;
    }
  }

  private _compute_grid_geometry(): void {
    const availSize = Math.min(this.width, this.height) * 0.45;
    this._cellSize = (availSize - CELL_GAP * (GRID_SIZE - 1)) / GRID_SIZE;
    const totalGrid = GRID_SIZE * this._cellSize + (GRID_SIZE - 1) * CELL_GAP;
    this._gridX = (this.width - totalGrid) / 2;
    this._gridY = (this.height - totalGrid) / 2 - 20;

    // Register click handlers for the two buttons
    this.canvas.onclick = (e: MouseEvent) => {
      if (this._phase !== 'stimulus') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const btnY = this._gridY + GRID_SIZE * (this._cellSize + CELL_GAP) + 30;
      if (y >= btnY && y <= btnY + 40) {
        const cx = this.width / 2;
        if (x >= cx - 130 && x <= cx - 30) {
          if (!this._userPressedL) {
            this._userPressedL = true;
            if (!this._firstReactionMs) this._firstReactionMs = precise_now() - this._phaseStart;
          }
        } else if (this._isDual && x >= cx + 30 && x <= cx + 130) {
          if (!this._userPressedA) {
            this._userPressedA = true;
            if (!this._firstReactionMs) this._firstReactionMs = precise_now() - this._phaseStart;
          }
        }
      }
    };
  }

  private _present_stimulus(): void {
    this._configure_difficulty();
    this._trialNumber++;

    // Generate stimulus (ensure some matches occur ~30% of the time)
    const nBackStim = this._trialNumber > this._n ? this._buffer[this._bufferIndex % this._n] : null;
    const shouldPositionMatch = this._trialNumber > this._n && Math.random() < 0.3;
    const shouldAudioMatch = this._isDual && this._trialNumber > this._n && Math.random() < 0.3;

    let position: number;
    if (shouldPositionMatch && nBackStim) {
      position = nBackStim.position;
    } else {
      do {
        position = Math.floor(Math.random() * 9);
      } while (nBackStim && position === nBackStim.position && this._trialNumber > this._n);
    }

    let soundIndex: number;
    if (shouldAudioMatch && nBackStim) {
      soundIndex = nBackStim.soundIndex;
    } else {
      do {
        soundIndex = Math.floor(Math.random() * 8);
      } while (nBackStim && soundIndex === nBackStim.soundIndex && this._trialNumber > this._n);
    }

    this._currentStimulus = { position, soundIndex };

    // Determine ground truth
    if (nBackStim && this._trialNumber > this._n) {
      this._positionMatch = position === nBackStim.position;
      this._audioMatch = this._isDual && soundIndex === nBackStim.soundIndex;
    } else {
      this._positionMatch = false;
      this._audioMatch = false;
    }

    // Write to circular buffer (Zero-Allocation)
    this._buffer[this._bufferIndex % this._n] = { position, soundIndex };
    this._bufferIndex++;

    // Reset user input
    this._userPressedL = false;
    this._userPressedA = false;
    this._firstReactionMs = null;
    this._feedbackMsg = '';

    // Play tone (audio-visual sync: same frame)
    if (this._isDual) {
      audioEngine.play_nback_letter(this._currentStimulus.soundIndex);
    }

    this._phase = 'stimulus';
    this._phaseStart = precise_now();
  }

  private _evaluate_response(): void {
    const finalRT = this._firstReactionMs || 0;

    // Only score trials after the first N warm-up trials
    if (this._trialNumber <= this._n) {
      this._feedbackMsg = '';
      this._phase = 'response';
      this._phaseStart = precise_now();
      return;
    }

    // Signal Detection Theory classification
    const posHit = this._positionMatch && this._userPressedL;
    const posMiss = this._positionMatch && !this._userPressedL;
    const posFalseAlarm = !this._positionMatch && this._userPressedL;
    const posCorrectRejection = !this._positionMatch && !this._userPressedL;

    let audioHit = false, audioMiss = false, audioFalseAlarm = false;
    if (this._isDual) {
      audioHit = this._audioMatch && this._userPressedA;
      audioMiss = this._audioMatch && !this._userPressedA;
      audioFalseAlarm = !this._audioMatch && this._userPressedA;
    }

    const isCorrect = (posHit || posCorrectRejection)
      && (!this._isDual || (audioHit || (!this._audioMatch && !this._userPressedA)));

    if (isCorrect) {
      audioEngine.play_correct();
      this._feedbackMsg = '✓';
      this._feedbackColor = 'hsl(145, 65%, 55%)';
    } else {
      audioEngine.play_error();
      const parts: string[] = [];
      if (posMiss) parts.push('Position ✗');
      if (posFalseAlarm) parts.push('Position ✗');
      if (audioMiss) parts.push('Audio ✗');
      if (audioFalseAlarm) parts.push('Audio ✗');
      this._feedbackMsg = parts.length > 0 ? parts.join('  ') : '✗';
      this._feedbackColor = 'hsl(0, 75%, 55%)';
    }

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect,
      reactionTimeMs: finalRT,
      metadata: {
        trial: this.currentTrial + 1,
        n: this._n,
        isDual: this._isDual,
        positionMatch: this._positionMatch,
        audioMatch: this._audioMatch,
        userPressedL: this._userPressedL,
        userPressedA: this._userPressedA,
        posHit, posMiss, posFalseAlarm, posCorrectRejection,
        audioHit, audioMiss, audioFalseAlarm,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
