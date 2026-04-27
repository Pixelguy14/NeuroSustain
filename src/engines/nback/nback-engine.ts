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
import { t } from '@shared/i18n.ts';

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
  private _isDual: boolean = false;
  private _stimulusDurationMs: number = 2000;
  private _interStimulusMs: number = 500;

  // N-Back parameters
  private _n: number = 1;

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
        if (elapsed > 4000) {
          this._phase = 'countdown';
          this.start_countdown(() => this._present_stimulus());
        }
        break;
      }

      case 'countdown': {
        // Handled by BaseEngine
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
        ctx.fillText(t('exercise.nback.tutorialTitle', { defaultValue: 'N-Back Tutorial' }), cx, cy - 80);

        ctx.font = '400 15px Inter, sans-serif';
        ctx.fillStyle = 'hsla(220, 15%, 70%, 0.9)';
        const textY = cy - 30;
        const nText = this._n === 1 ? t('exercise.nback.oneStep', { defaultValue: '1 step' }) : t('exercise.nback.nSteps', { n: this._n, defaultValue: `${this._n} steps` });
        
        if (this._isDual) {
          ctx.fillText(t('exercise.nback.dualPos', { n: nText, defaultValue: `Match POSITION ${nText} back` }), cx, textY);
          ctx.fillText(t('exercise.nback.dualAudio', { n: nText, defaultValue: `Match SOUND ${nText} back` }), cx, textY + 30);
          ctx.fillText(t('exercise.nback.bothMatch', { defaultValue: 'Both can match at the same time.' }), cx, textY + 60);
        } else {
          ctx.fillText(t('exercise.nback.singlePos', { n: nText, defaultValue: `Match POSITION ${nText} back` }), cx, textY);
        }

        ctx.font = '500 13px Inter, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.fillText(this.width < 600 ? t('exercise.nback.tapStart', { defaultValue: 'TAP TO START' }) : t('exercise.nback.keyStart', { defaultValue: 'Press ANY KEY to start...' }), cx, cy + 100);
        break;
      }

      case 'countdown':
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
    const isMobile = this.width < 600;
    const btnH = isMobile ? 60 : 40;
    const btnY = this._gridY + GRID_SIZE * (this._cellSize + CELL_GAP) + (isMobile ? 40 : 30);
    const cx = this.width / 2;

    ctx.font = `600 ${isMobile ? 16 : 13}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const btnW = isMobile ? 140 : 100;
    const gap = isMobile ? 20 : 60;

    // Position match key
    const lx = cx - gap/2 - btnW/2;
    ctx.beginPath();
    ctx.roundRect(lx - btnW/2, btnY, btnW, btnH, 12);
    ctx.fillStyle = this._userPressedL
      ? 'hsla(175, 60%, 30%, 0.8)'
      : 'hsla(225, 25%, 15%, 0.5)';
    ctx.fill();
    ctx.strokeStyle = this._userPressedL
      ? 'hsl(175, 70%, 50%)'
      : 'hsla(220, 20%, 30%, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'hsl(175, 70%, 55%)';
    ctx.fillText(isMobile ? 'POSITION' : '[L] Position', lx, btnY + btnH/2);

    if (this._isDual) {
      // Audio match key
      const ax = cx + gap/2 + btnW/2;
      ctx.beginPath();
      ctx.roundRect(ax - btnW/2, btnY, btnW, btnH, 12);
      ctx.fillStyle = this._userPressedA
        ? 'hsla(280, 60%, 30%, 0.8)'
        : 'hsla(225, 25%, 15%, 0.5)';
      ctx.fill();
      ctx.strokeStyle = this._userPressedA
        ? 'hsl(280, 60%, 55%)'
        : 'hsla(220, 20%, 30%, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'hsl(280, 60%, 60%)';
      ctx.fillText(isMobile ? 'SOUND' : '[A] Audio', ax, btnY + btnH/2);
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
    // Defensive check for zero width (can happen if parent isn't laid out yet)
    const w = this.width || window.innerWidth;
    const h = this.height || window.innerHeight;

    const isMobile = w < 600;
    const availSize = isMobile 
      ? Math.min(w * 0.85, h * 0.4) // Slightly larger on mobile for visibility
      : Math.min(w, h) * 0.45;
      
    this._cellSize = (availSize - CELL_GAP * (GRID_SIZE - 1)) / GRID_SIZE;
    const totalGrid = GRID_SIZE * this._cellSize + (GRID_SIZE - 1) * CELL_GAP;
    this._gridX = (w - totalGrid) / 2;
    this._gridY = isMobile ? 130 : (h - totalGrid) / 2 - 20;

    // Register click handlers for the two buttons
    this.canvas.onclick = (e: MouseEvent) => {
      if (this._phase === 'tutorial') {
        this._phase = 'countdown';
        this.start_countdown(() => this._present_stimulus());
        return;
      }

      if (this._phase !== 'stimulus') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const btnH = isMobile ? 60 : 40;
      const btnY = this._gridY + GRID_SIZE * (this._cellSize + CELL_GAP) + (isMobile ? 40 : 30);
      
      if (y >= btnY && y <= btnY + btnH) {
        const cx = this.width / 2;
        const btnW = isMobile ? 140 : 100;
        const gap = isMobile ? 20 : 60;
        
        if (x >= cx - gap/2 - btnW && x <= cx - gap/2) {
          if (!this._userPressedL) {
            this._userPressedL = true;
            if (!this._firstReactionMs) this._firstReactionMs = precise_now() - this._phaseStart;
          }
        } else if (this._isDual && x >= cx + gap/2 && x <= cx + gap/2 + btnW) {
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
    
    // VALIDATION: Only allow match if the buffered stimulus was valid (not -1)
    const canPositionMatch = nBackStim && nBackStim.position !== -1;
    const canAudioMatch = this._isDual && nBackStim && nBackStim.soundIndex !== -1;

    const shouldPositionMatch = canPositionMatch && Math.random() < 0.3;
    const shouldAudioMatch = canAudioMatch && Math.random() < 0.3;

    let position: number;
    if (shouldPositionMatch && nBackStim) {
      position = nBackStim.position;
    } else {
      do {
        position = Math.floor(Math.random() * 9);
      } while (canPositionMatch && position === nBackStim!.position);
    }

    let soundIndex: number;
    if (shouldAudioMatch && nBackStim) {
      soundIndex = nBackStim.soundIndex;
    } else {
      do {
        soundIndex = Math.floor(Math.random() * 8);
      } while (canAudioMatch && soundIndex === nBackStim!.soundIndex);
    }

    this._currentStimulus = { position, soundIndex };

    // Determine ground truth (only if buffered stimulus was valid)
    this._positionMatch = !!(canPositionMatch && position === nBackStim!.position);
    this._audioMatch = !!(canAudioMatch && soundIndex === nBackStim!.soundIndex);

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
