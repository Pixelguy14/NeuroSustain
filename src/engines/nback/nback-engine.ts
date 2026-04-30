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

type Phase = 'tutorial' | 'countdown' | 'stimulus' | 'response' | 'feedback' | 'message' | 'done';

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
  private _lastN: number = 0;
  private _lastDual: boolean = false;
  private _alertMsg: string = '';
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

  // Feedback
  private _feedbackMsg: string = '';
  private _feedbackColor: string = '';

  // Dynamic Shift Tracking
  private _previousN: number = 1;
  private _previousIsDual: boolean = false;
  private _warmupTrialsRemaining: number = 0;
  private _correctPos: number | null = null; // Position to highlight on miss

  // Split Reaction Times
  private _posReactionMs: number | null = null;
  private _audioReactionMs: number | null = null;

  // Grid geometry (computed once)
  private _gridX: number = 0;
  private _gridY: number = 0;
  private _cellSize: number = 0;
  private _btnPressL: number = 0;
  private _btnPressA: number = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    // Only show tutorial on trial 1 (first run of the session)
    this._phase = 'tutorial';
    this._phaseStart = precise_now();
    this._configure_difficulty();
    this._compute_grid_geometry();

    // Always allocate for maximum possible N (up to 9) to prevent dynamic resizing crashes
    this._buffer = Array.from({ length: 10 }, () => ({ position: -1, soundIndex: -1 }));
    this._bufferIndex = 0;
    this._trialNumber = 0;
    this._previousN = this._n;
    this._previousIsDual = this._isDual;
    this._warmupTrialsRemaining = 0;
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
    const isMobile = w < 600;

    ctx.fillStyle = 'hsl(225, 45%, 6%)';
    ctx.fillRect(0, 0, w, h);

    // Background texture
    this.draw_background_mesh(ctx, w, h);

    // HUD
    this.draw_hud(ctx, w);

    const modeName = this._isDual ? t('exercise.nback.modeDual', { defaultValue: 'Dual' }) : t('exercise.nback.modeSingle', { defaultValue: 'Single' });
    const backLabel = t('exercise.nback.backLabel', { n: this._n, defaultValue: `${this._n}-Back` });
    this.draw_status_badge(ctx, 32, 52, `${backLabel} ${modeName}`, 'hsla(175, 70%, 50%, 0.7)', 'left');

    switch (this._phase) {
      case 'tutorial': {
        this.draw_glass_panel(ctx, cx - 240, cy - 140, 480, 280, 20);

        ctx.font = '800 24px Outfit, sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(t('exercise.nback.tutorialTitle', { defaultValue: 'N-Back Tutorial' }), cx, cy - 80);

        ctx.font = '500 15px Outfit, sans-serif';
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

        ctx.font = '800 11px Outfit, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.fillText(this.width < 600 ? t('exercise.nback.tapStart', { defaultValue: 'TAP TO START' }) : t('exercise.nback.keyStart', { defaultValue: 'PRESS ANY KEY TO START' }), cx, cy + 100);
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
          ctx.font = 'bold 16px Outfit, sans-serif';
          ctx.fillStyle = this._feedbackColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(this._feedbackMsg, cx, this._gridY - 35);
        }
        this._render_controls(ctx);
        break;

      case 'feedback':
        this._render_grid(ctx, false);
        // "Clearer Feedback on Misses": Highlight correct position if it was missed
        if (this._correctPos !== null) {
          const row = Math.floor(this._correctPos / GRID_SIZE);
          const col = this._correctPos % GRID_SIZE;
          const x = this._gridX + col * (this._cellSize + CELL_GAP);
          const y = this._gridY + row * (this._cellSize + CELL_GAP);

          ctx.beginPath();
          ctx.roundRect(x, y, this._cellSize, this._cellSize, 6);
          ctx.fillStyle = 'hsla(45, 80%, 60%, 0.4)'; // Soft yellow
          ctx.fill();
          ctx.strokeStyle = 'hsla(45, 80%, 60%, 0.8)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        const progress = (precise_now() - this._phaseStart) / 600;
        this.draw_feedback_orb(ctx, cx, cy - 20, this._feedbackMsg === '✓', progress);
        break;

      case 'message':
        this._render_grid(ctx, false);
        this.draw_glass_panel(ctx, cx - 180, cy - 80, 360, 160, 20);
        ctx.font = '800 18px Outfit, sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(t('exercise.nback.taskChanged', { defaultValue: 'TASK CHANGED' }), cx, cy - 30);

        ctx.font = '500 14px Outfit, sans-serif';
        ctx.fillStyle = 'hsla(220, 15%, 70%, 0.9)';
        ctx.fillText(this._alertMsg, cx, cy + 10);

        ctx.font = '800 11px Outfit, sans-serif';
        ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
        ctx.fillText(isMobile ? t('exercise.nback.tapToContinue', { defaultValue: 'TAP TO CONTINUE' }) : t('exercise.nback.keyToContinue', { defaultValue: 'PRESS ANY KEY TO CONTINUE' }), cx, cy + 50);
        break;

      case 'done':
        break;
    }
  }

  private _render_grid(ctx: CanvasRenderingContext2D, showHighlight: boolean): void {
    // Permanent HUD instruction
    const cx = this.width / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
    ctx.font = '800 10px Outfit, sans-serif';
    const nText = this._n === 1
      ? t('exercise.nback.oneStep', { defaultValue: '1 step' })
      : t('exercise.nback.nSteps', { n: this._n, defaultValue: `${this._n} steps` });

    if (this._isDual) {
      ctx.fillText(t('exercise.nback.matchBoth', { n: nText, defaultValue: `MATCH POSITION & SOUND ${nText} BACK` }).toUpperCase(), cx, this._gridY - 20);
    } else {
      ctx.fillText(t('exercise.nback.matchPosOnly', { n: nText, defaultValue: `MATCH POSITION ${nText} BACK` }).toUpperCase(), cx, this._gridY - 20);
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
          ctx.shadowBlur = 24;
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          // Inactive cell
          this.draw_glass_panel(ctx, x, y, this._cellSize, this._cellSize, 8);
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

    ctx.font = `800 ${isMobile ? 12 : 10}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const btnW = isMobile ? 130 : 110;
    const gap = isMobile ? 20 : 40;
    const now = precise_now();

    // Position match button
    const lx = cx - gap / 2 - btnW;
    const posLabel = isMobile ? t('exercise.nback.posLabelMobile') : t('exercise.nback.posLabel', { defaultValue: 'Position' });
    const isLActive = now - this._btnPressL < 100;

    this.draw_tactile_button(
      ctx, lx, btnY, btnW, btnH,
      posLabel,
      {
        bg: isLActive ? 'hsla(175, 60%, 30%, 0.8)' : 'hsla(225, 25%, 15%, 0.6)',
        stroke: isLActive ? 'hsl(175, 70%, 50%)' : 'hsla(220, 20%, 35%, 0.3)',
        text: isLActive ? 'white' : 'hsl(175, 70%, 55%)'
      },
      isLActive
    );
    if (!isMobile) {
      ctx.font = '800 9px Outfit, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 50%, 0.5)';
      ctx.fillText('[L]', lx + btnW / 2, btnY + btnH + 12);
    }

    if (this._isDual) {
      // Audio match button
      const ax = cx + gap / 2;
      const audioLabel = isMobile ? t('exercise.nback.audioLabelMobile') : t('exercise.nback.audioLabel', { defaultValue: 'Audio' });
      const isAActive = now - this._btnPressA < 100;

      this.draw_tactile_button(
        ctx, ax, btnY, btnW, btnH,
        audioLabel,
        {
          bg: isAActive ? 'hsla(280, 60%, 30%, 0.8)' : 'hsla(225, 25%, 15%, 0.6)',
          stroke: isAActive ? 'hsl(280, 60%, 55%)' : 'hsla(220, 20%, 35%, 0.3)',
          text: isAActive ? 'white' : 'hsl(280, 60%, 60%)'
        },
        isAActive
      );
      if (!isMobile) {
        ctx.font = '800 9px Outfit, sans-serif';
        ctx.fillStyle = 'hsla(220, 15%, 50%, 0.5)';
        ctx.fillText('[A]', ax + btnW / 2, btnY + btnH + 12);
      }
    }
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase === 'message') {
      this._phase = 'countdown';
      this._phaseStart = precise_now();
      this.start_countdown(() => this._present_stimulus());
      return;
    }

    if (this._phase === 'tutorial') {
      this._phase = 'countdown';
      this._phaseStart = precise_now();
      return;
    }

    if (this._phase !== 'stimulus') return;

    if (code === 'KeyL') {
      if (!this._userPressedL) {
        this._userPressedL = true;
        this._btnPressL = precise_now();
        if (!this._posReactionMs) this._posReactionMs = precise_now() - this._phaseStart;
      }
    } else if (code === 'KeyA' && this._isDual) {
      if (!this._userPressedA) {
        this._userPressedA = true;
        this._btnPressA = precise_now();
        if (!this._audioReactionMs) this._audioReactionMs = precise_now() - this._phaseStart;
      }
    }
  }

  protected on_cleanup(): void {
    this.canvas.onpointerdown = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _configure_difficulty(): boolean {
    const diff = this._currentDifficulty;

    // 1. Calculate future state without mutating current state yet
    let nextN = 1;
    let nextDual = false;
    let nextStimulusDurationMs = 2500;
    let nextInterStimulusMs = 500;

    if (diff <= 3) {
      nextN = 1; nextDual = false;
    } else if (diff <= 5) {
      nextN = 1; nextDual = true;
    } else if (diff <= 7) {
      nextN = 2; nextDual = true;
      nextStimulusDurationMs = 2000;
    } else {
      nextN = 3; nextDual = true;
      nextStimulusDurationMs = 2000;
      nextInterStimulusMs = 400;
    }

    // 2. THE INTERRUPT: Check for major rule transitions
    if (this._lastN > 0 && (nextN !== this._lastN || nextDual !== this._lastDual)) {
      if (nextN !== this._lastN) {
        this._alertMsg = nextN > this._lastN
          ? t('exercise.nback.alertNIncrease', { n: nextN, defaultValue: `NOW MATCHING ${nextN} STEPS BACK` })
          : t('exercise.nback.alertNDecrease', { n: nextN, defaultValue: `NOW MATCHING ${nextN} STEPS BACK` });
      } else {
        this._alertMsg = nextDual
          ? t('exercise.nback.alertDualEnabled', { defaultValue: 'NOW MATCHING BOTH POSITION & SOUND' })
          : t('exercise.nback.alertDualDisabled', { defaultValue: 'NOW MATCHING POSITION ONLY' });
      }

      // Update tracking state so it bypasses on the next pass
      this._lastN = nextN;
      this._lastDual = nextDual;

      this._phase = 'message';
      this._phaseStart = precise_now();

      return true; // Signal that an interrupt occurred
    }

    // 3. Apply the new difficulty settings if no interrupt occurred
    this._n = nextN;
    this._isDual = nextDual;
    this._stimulusDurationMs = nextStimulusDurationMs;
    this._interStimulusMs = nextInterStimulusMs;
    this._lastN = nextN;
    this._lastDual = nextDual;

    return false; // No interrupt
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
    this.canvas.onpointerdown = (e: MouseEvent) => {
      if (this._phase === 'message') {
        this._phase = 'countdown';
        this.start_countdown(() => this._present_stimulus());
        return;
      }

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
        const btnW = isMobile ? 130 : 110;
        const gap = isMobile ? 20 : 40;

        if (x >= cx - gap / 2 - btnW && x <= cx - gap / 2) {
          if (!this._userPressedL) {
            this._userPressedL = true;
            this._btnPressL = precise_now();
            if (!this._posReactionMs) this._posReactionMs = precise_now() - this._phaseStart;
          }
        } else if (this._isDual && x >= cx + gap / 2 && x <= cx + gap / 2 + btnW) {
          if (!this._userPressedA) {
            this._userPressedA = true;
            this._btnPressA = precise_now();
            if (!this._audioReactionMs) this._audioReactionMs = precise_now() - this._phaseStart;
          }
        }
      }
    };
  }

  private _present_stimulus(): void {
    // 1. Check for rule changes and interrupt if necessary
    const wasInterrupted = this._configure_difficulty();
    if (wasInterrupted) {
      return; // CRITICAL ABORT: Stop executing and wait for user to dismiss the message
    }

    this._trialNumber++;

    // Detect dynamic difficulty shift (N change or Dual change)
    if (this._n !== this._previousN || this._isDual !== this._previousIsDual) {
      this._warmupTrialsRemaining = this._n; // Reset evaluation window to fill buffer
      this._previousN = this._n;
      this._previousIsDual = this._isDual;
    }
    // Decrement happens in _evaluate_response to ensure the FULL trial window is skipped

    // Generate stimulus (ensure some matches occur ~30% of the time)
    // To find N-back in a circular buffer of size 10: (current - N + 10) % 10
    const BUFFER_SIZE = 10;
    const lookbackIndex = (this._bufferIndex - this._n + BUFFER_SIZE) % BUFFER_SIZE;
    const nBackStim = this._trialNumber > this._n ? this._buffer[lookbackIndex] : null;

    // VALIDATION: Only allow match if the buffered stimulus was valid (not -1)
    // AND we are not in a warmup window (meaning the buffer contains stimuli from the PREVIOUS level)
    const isWarmup = this._trialNumber <= this._n || this._warmupTrialsRemaining > 0;
    const canPositionMatch = nBackStim && nBackStim.position !== -1 && !isWarmup;
    const canAudioMatch = this._isDual && nBackStim && nBackStim.soundIndex !== -1 && !isWarmup;

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

    // Write to circular buffer (Zero-Allocation: Static length 10)
    this._buffer[this._bufferIndex % 10] = { position, soundIndex };
    this._bufferIndex++;

    // Reset user input
    this._userPressedL = false;
    this._userPressedA = false;
    this._posReactionMs = null;
    this._audioReactionMs = null;
    this._feedbackMsg = '';
    this._correctPos = null;

    // Play tone (audio-visual sync: same frame)
    if (this._isDual) {
      audioEngine.play_nback_letter(this._currentStimulus.soundIndex);
    }

    this._phase = 'stimulus';
    this._phaseStart = precise_now();
  }

  private _evaluate_response(): void {
    const finalRT = Math.max(this._posReactionMs || 0, this._audioReactionMs || 0);

    // Reject scoring if we are in initial warmup OR a dynamic shift warmup window
    if (this._trialNumber <= this._n || this._warmupTrialsRemaining > 0) {
      if (this._warmupTrialsRemaining > 0) this._warmupTrialsRemaining--;

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
      if (posMiss) {
        // Find lookback position for visual hint
        const lookbackIndex = (this._bufferIndex - 1 - this._n + 10) % 10;
        const nBackStim = this._buffer[lookbackIndex];
        if (nBackStim && nBackStim.position !== -1) {
          this._correctPos = nBackStim.position;
        }
      }

      const parts: string[] = [];
      if (posMiss || posFalseAlarm) parts.push(t('exercise.nback.posError', { defaultValue: 'Position ✗' }));
      if (audioMiss || audioFalseAlarm) parts.push(t('exercise.nback.audioError', { defaultValue: 'Audio ✗' }));
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
        posRT: this._posReactionMs,
        audioRT: this._audioReactionMs,
        posHit, posMiss, posFalseAlarm, posCorrectRejection,
        audioHit, audioMiss, audioFalseAlarm,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
