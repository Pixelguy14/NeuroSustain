// ============================================================
// NeuroSustain — Piano Player Engine
// Auditory Working Memory & Sequential Processing
//
// Mechanics:
//   - Encoding: System plays a sequence of pure tones (with visual cues).
//   - Retention: Brief pause to hold sequence in working memory.
//   - Recall: User replicates the sequence (forward or reverse).
//
// Difficulty Scaling:
//   1-3: 4 pads (C major chord), sequence 3-4, visual cues.
//   4-7: 6 pads (Hexatonic), sequence 5-7, visual cues, faster.
//   8-10: 9 pads, sequence 7-10, REVERSE + spatial shuffle.
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { InputBridge, type InputEvent } from '@core/input/input-bridge.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'countdown' | 'encoding' | 'retention' | 'recall' | 'feedback';

interface Pad {
  id: number;
  freq: number;
  colorHsl: string;
  idleStrokeStyle: string; // Cached — Zero-Allocation
  keyLabel: string; // Visible keyboard shortcut
  keyCode: string; // KeyboardEvent.code mapping
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Frequency mapping (C4 major scale baseline)
const FREQUENCIES = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  349.23, // F4
  392.00, // G4
  440.00, // A4
  493.88, // B4
  523.25, // C5
  587.33, // D5
];

// Keyboard layout per grid size
const KEY_MAPS: Record<number, { label: string; code: string }[]> = {
  4: [
    { label: 'Q', code: 'KeyQ' }, { label: 'W', code: 'KeyW' },
    { label: 'A', code: 'KeyA' }, { label: 'S', code: 'KeyS' },
  ],
  6: [
    { label: 'Q', code: 'KeyQ' }, { label: 'W', code: 'KeyW' }, { label: 'E', code: 'KeyE' },
    { label: 'A', code: 'KeyA' }, { label: 'S', code: 'KeyS' }, { label: 'D', code: 'KeyD' },
  ],
  9: [
    { label: 'Q', code: 'KeyQ' }, { label: 'W', code: 'KeyW' }, { label: 'E', code: 'KeyE' },
    { label: 'A', code: 'KeyA' }, { label: 'S', code: 'KeyS' }, { label: 'D', code: 'KeyD' },
    { label: 'Z', code: 'KeyZ' }, { label: 'X', code: 'KeyX' }, { label: 'C', code: 'KeyC' },
  ],
};

export class PianoPlayerEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'PianoPlayer';
  readonly primaryPillar: CognitivePillar = 'WorkingMemory';
  readonly totalTrials: number = 10;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;
  private _countdownValue: number = 3;

  private _pads: Pad[] = [];
  private _sequence: number[] = []; // Original sequence
  private _recallSequence: number[] = []; // What the user must input (may be reversed)
  private _userSequence: number[] = [];
  private _isReverse: boolean = false;
  
  // Encoding phase state
  private _encodingIndex: number = 0;
  private _encodingNoteStart: number = 0;
  private _lastPlayedNoteIndex: number = -1;
  private _noteDurationMs: number = 500;
  private _noteGapMs: number = 200;

  // Recall phase state
  private _activePadId: number | null = null;
  private _activePadStartTime: number = 0;
  private _recallStartTime: number = 0;
  private _firstTapTime: number = 0; // Cognitive RT
  private _lastClickTime: number = 0;

  private _inputBridge: InputBridge | null = null;
  private _isCorrect: boolean = false;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStart = precise_now();
    this._init_grid();

    // Map canvas coordinates to pad IDs
    this._inputBridge = new InputBridge(this.canvas, (x, y) => {
      if (this._phase !== 'recall') return null;
      for (const pad of this._pads) {
        if (x >= pad.x && x <= pad.x + pad.w && y >= pad.y && y <= pad.y + pad.h) {
          return String(pad.id);
        }
      }
      return null;
    });

    this._inputBridge.on_input((event: InputEvent) => this._on_input(event));
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        const v = 3 - Math.floor(elapsed / 800);
        if (v <= 0) {
          this._start_trial();
        } else {
          this._countdownValue = v;
        }
        break;
      }

      case 'encoding': {
        const timeSinceNote = precise_now() - this._encodingNoteStart;
        
        if (this._encodingIndex < this._sequence.length) {
          if (this._lastPlayedNoteIndex < this._encodingIndex) {
            const padId = this._sequence[this._encodingIndex]!;
            const freq = this._pads.find(p => p.id === padId)?.freq || 440;
            audioEngine.play_musical_tone(freq, this._noteDurationMs);
            this._lastPlayedNoteIndex = this._encodingIndex;
            this._encodingNoteStart = precise_now();
          } else if (timeSinceNote > this._noteDurationMs + this._noteGapMs) {
            this._encodingIndex++;
          }
        } else {
          // No shuffle — maintain spatial-identity binding for clinical consistency
          this._phase = 'retention';
          this._phaseStart = precise_now();
        }
        break;
      }

      case 'retention':
        if (elapsed > 1000) {
          this._phase = 'recall';
          this._phaseStart = precise_now();
          this._recallStartTime = precise_now();
        }
        break;

      case 'recall':
        if (this._activePadId !== null && precise_now() - this._activePadStartTime > 150) {
          this._activePadId = null;
        }
        
        if (precise_now() - Math.max(this._recallStartTime, this._lastClickTime) > 10000) {
           this._finish_trial(false);
        }
        break;

      case 'feedback':
        if (elapsed > 1500) {
          if (this.currentTrial >= this.totalTrials) return;
          this._start_trial();
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

      case 'encoding':
        this._render_pads(ctx);
        ctx.font = '500 18px Inter, sans-serif';
        ctx.fillStyle = 'hsla(220, 15%, 55%, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText('Listen...', cx, 60);
        break;

      case 'retention':
        ctx.font = '500 18px Inter, sans-serif';
        ctx.fillStyle = 'hsla(220, 15%, 55%, 0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('...', cx, cy);
        break;

      case 'recall':
        this._render_pads(ctx);
        this._render_visual_slots(ctx, cx, 75);
        ctx.font = '600 16px Inter, sans-serif';
        
        if (this._isReverse) {
          const pulse = Math.sin(precise_now() / 200) * 0.2 + 0.8;
          ctx.font = 'bold 20px Inter, sans-serif';
          ctx.fillStyle = `hsla(30, 90%, 60%, ${pulse})`;
          ctx.fillText('INPUT IN REVERSE ORDER', cx, 50);
        } else {
          ctx.font = '600 16px Inter, sans-serif';
          ctx.fillStyle = 'hsl(145, 70%, 58%)';
          ctx.fillText('Your Turn', cx, 50);
        }
        break;

      case 'feedback':
        this._render_pads(ctx);
        ctx.font = 'bold 32px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (this._isCorrect) {
          ctx.fillStyle = 'hsl(145, 65%, 55%)';
          ctx.fillText('✓', cx, 60);
        } else {
          ctx.fillStyle = 'hsl(0, 75%, 55%)';
          ctx.fillText('✗', cx, 60);
        }
        break;
    }
  }

  private _render_pads(ctx: CanvasRenderingContext2D): void {
    for (const pad of this._pads) {
      let isActive = false;
      if (this._phase === 'encoding') {
        const timeSinceNote = precise_now() - this._encodingNoteStart;
        if (this._sequence[this._encodingIndex] === pad.id && timeSinceNote < this._noteDurationMs) {
          isActive = true;
        }
      } else if (this._phase === 'recall' && this._activePadId === pad.id) {
        isActive = true;
      }

      ctx.beginPath();
      ctx.roundRect(pad.x, pad.y, pad.w, pad.h, 12);

      if (isActive) {
        ctx.fillStyle = pad.colorHsl;
        ctx.fill();
        ctx.shadowColor = pad.colorHsl;
        ctx.shadowBlur = 20;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = 'hsla(225, 30%, 15%, 0.6)';
        ctx.fill();
        ctx.strokeStyle = pad.idleStrokeStyle; // Cached — Zero-Allocation
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Key label pill (bottom-right of pad)
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 70%, 0.7)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(pad.keyLabel, pad.x + pad.w - 8, pad.y + pad.h - 6);
    }
  }

  /** Visual Slots: show N slots that fill as the user inputs notes */
  private _render_visual_slots(ctx: CanvasRenderingContext2D, cx: number, y: number): void {
    const total = this._recallSequence.length;
    const current = this._userSequence.length;
    const slotW = 28;
    const slotH = 20;
    const gap = 8;
    const totalWidth = total * slotW + (total - 1) * gap;
    const startX = cx - totalWidth / 2;

    for (let i = 0; i < total; i++) {
      const sx = startX + i * (slotW + gap);

      ctx.beginPath();
      ctx.roundRect(sx, y, slotW, slotH, 4);

      // Visual slots fill in the order the user inputs, even in reverse mode.
      // This provides more intuitive feedback than right-to-left filling.
      const fillIndex = i;

      if (fillIndex < current) {
        // Filled — use the color of the pad the user pressed
        const padId = this._userSequence[fillIndex]!;
        const pad = this._pads.find(p => p.id === padId);
        ctx.fillStyle = pad ? pad.colorHsl : 'hsl(145, 65%, 55%)';
        ctx.fill();
      } else {
        // Empty slot
        ctx.fillStyle = 'hsla(225, 30%, 15%, 0.4)';
        ctx.fill();
        ctx.strokeStyle = 'hsla(220, 20%, 35%, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  protected on_key_event(e: KeyboardEvent, timestamp: number): void {
    if (this._phase !== 'recall') return;
    if (e.repeat) return; // Prevent double-triggering when holding key
    
    super.on_key_event(e, timestamp);
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'recall') return;
    
    // Map keyboard code to pad ID
    for (const pad of this._pads) {
      if (pad.keyCode === code) {
        this._handle_pad_press(pad.id);
        return;
      }
    }
  }

  protected on_cleanup(): void {
    this._inputBridge?.destroy();
  }

  // ── Logic ───────────────────────────────────────────────

  private _init_grid(): void {
    const diff = this._currentDifficulty;
    let cols: number;
    let rows: number;

    if (diff <= 3) {
      cols = 2; rows = 2;
    } else if (diff <= 7) {
      cols = 3; rows = 2;
    } else {
      cols = 3; rows = 3;
    }

    const numPads = cols * rows;
    const keyMap = KEY_MAPS[numPads] || KEY_MAPS[4]!;
    
    this._pads = [];
    for (let i = 0; i < numPads; i++) {
      const hue = (i * (360 / numPads)) % 360;
      const colorHsl = `hsl(${hue}, 70%, 60%)`;
      const key = keyMap[i] || { label: '?', code: '' };
      this._pads.push({
        id: i,
        freq: FREQUENCIES[i] || 440,
        colorHsl,
        idleStrokeStyle: `hsla(${hue}, 70%, 60%, 0.3)`, // Cached once
        keyLabel: key.label,
        keyCode: key.code,
        col: i % cols,
        row: Math.floor(i / cols),
        x: 0, y: 0, w: 0, h: 0
      });
    }

    this._layout_pads(cols, rows);
  }

  private _layout_pads(cols: number, rows: number): void {
    const gap = 16;
    const margin = 80;
    
    const availableW = this.width - margin * 2;
    const availableH = this.height - margin * 2 - 120; // Room for HUD + slots
    
    const padW = (availableW - gap * (cols - 1)) / cols;
    const padH = (availableH - gap * (rows - 1)) / rows;
    
    const startX = (this.width - availableW) / 2;
    const startY = (this.height - availableH) / 2 + 40;

    for (const pad of this._pads) {
      pad.w = padW;
      pad.h = padH;
      pad.x = startX + pad.col * (padW + gap);
      pad.y = startY + pad.row * (padH + gap);
    }
  }

  // Removed shuffle logic to preserve spatial mapping integrity


  private _start_trial(): void {
    const diff = this._currentDifficulty;
    
    // Reset grid FIRST to ensure this._pads is correctly sized for current difficulty
    this._init_grid();

    let seqLength: number;
    if (diff <= 3) seqLength = 3;
    else if (diff <= 7) seqLength = 5 + Math.floor(Math.random() * 2); // 5-6
    else seqLength = 7 + Math.floor(Math.random() * 2); // 7-8

    this._sequence = [];
    for (let i = 0; i < seqLength; i++) {
      let nextPad: number;
      do {
        nextPad = Math.floor(Math.random() * this._pads.length);
      } while (i > 0 && nextPad === this._sequence[i - 1]);
      this._sequence.push(nextPad);
    }

    // Level 8+: reverse recall
    this._isReverse = diff >= 8;
    this._recallSequence = this._isReverse ? [...this._sequence].reverse() : [...this._sequence];

    // Tempo: generous floors so each note can be encoded
    this._noteDurationMs = Math.max(400, 700 - diff * 25);
    this._noteGapMs = Math.max(200, 350 - diff * 15);

    this._userSequence = [];
    this._encodingIndex = 0;
    this._lastPlayedNoteIndex = -1;
    this._encodingNoteStart = precise_now();
    this._firstTapTime = 0;
    
    // Grid already reset at start of function

    this._phase = 'encoding';
    this._phaseStart = precise_now();
  }

  private _on_input(event: InputEvent): void {
    if (this._phase !== 'recall') return;
    
    const padId = parseInt(event.value, 10);
    if (isNaN(padId)) return;

    this._handle_pad_press(padId);
  }

  private _handle_pad_press(padId: number): void {
    const pad = this._pads.find(p => p.id === padId);
    if (!pad) return;

    // Visual/Audio feedback
    audioEngine.play_musical_tone(pad.freq, 150);
    this._activePadId = padId;
    this._activePadStartTime = precise_now();
    this._lastClickTime = precise_now();

    // Record first tap time (Cognitive RT)
    if (this._userSequence.length === 0) {
      this._firstTapTime = precise_now() - this._recallStartTime;
    }

    this._userSequence.push(padId);

    // Deferred evaluation: wait until the sequence is fully entered
    if (this._userSequence.length === this._recallSequence.length) {
      let isPerfect = true;
      for (let i = 0; i < this._recallSequence.length; i++) {
        if (this._userSequence[i] !== this._recallSequence[i]) {
          isPerfect = false;
          break;
        }
      }

      if (isPerfect) {
        audioEngine.play_correct();
        this._finish_trial(true);
      } else {
        audioEngine.play_error();
        this._finish_trial(false);
      }
    }
  }

  private _finish_trial(isCorrect: boolean): void {
    this._isCorrect = isCorrect;
    const totalRecallMs = precise_now() - this._recallStartTime;
    
    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect,
      reactionTimeMs: this._firstTapTime > 0 ? this._firstTapTime : totalRecallMs, // Cognitive RT
      metadata: {
        trial: this.currentTrial + 1,
        sequenceLength: this._sequence.length,
        isReverse: this._isReverse,
        isSpatialShuffle: this._currentDifficulty >= 8,
        cognitiveTimeMs: this._firstTapTime,
        motorTimeMs: totalRecallMs,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
