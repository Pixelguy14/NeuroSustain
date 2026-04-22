// ============================================================
// NeuroSustain — Free Draw Engine
// Refractory Mode — non-scored DMN activation session
//
// Triggered when cognitive fatigue is detected. 60 seconds of
// unguided creative flow with procedural color cycling.
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

export class FreeDrawEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'FreeDraw';
  readonly primaryPillar: CognitivePillar = 'SustainedAttention'; // Placeholder pillar
  readonly totalTrials: number = 1; // Single continuous trial

  private _isDrawing: boolean = false;
  private _lastX: number = 0;
  private _lastY: number = 0;
  private _hue: number = 0;
  private _timer: number = 60;
  private _startTime: number = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._startTime = precise_now();
    this._timer = 60;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = 4;
    
    // Initial clear
    this.ctx.fillStyle = 'hsl(225, 45%, 6%)';
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Pointer events for drawing
    this.canvas.addEventListener('pointerdown', (e) => this._start_drawing(e));
    this.canvas.addEventListener('pointermove', (e) => this._draw(e));
    window.addEventListener('pointerup', () => this._stop_drawing());

    audioEngine.start_ambience();
  }

  protected on_update(dt: number): void {
    const elapsed = (precise_now() - this._startTime) / 1000;
    this._timer = Math.max(0, 60 - elapsed);

    if (this._timer <= 0) {
      this._complete();
    }

    // Color cycle
    this._hue = (this._hue + dt * 0.05) % 360;
  }

  protected on_render(ctx: CanvasRenderingContext2D): void {
    // We DON'T clear the background here so the drawing persists.
    // Instead, we draw UI overlays on top.

    // Timer bar at bottom
    const barH = 4;
    const progress = this._timer / 60;
    ctx.fillStyle = 'hsla(220, 20%, 20%, 0.5)';
    ctx.fillRect(0, this.height - barH, this.width, barH);
    ctx.fillStyle = `hsl(${this._hue}, 70%, 50%)`;
    ctx.fillRect(0, this.height - barH, this.width * progress, barH);

    // Fade top HUD
    ctx.save();
    const hudY = 60;
    ctx.fillStyle = 'hsla(225, 45%, 6%, 0.8)';
    ctx.fillRect(0, 0, this.width, hudY);
    
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 70%, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('REFRACTORY SESSION — FREE FLOW', this.width / 2, 35);
    ctx.restore();
  }

  protected on_key_down(code: string): void {
    if (code === 'KeyC') {
      // Clear canvas
      this.ctx.fillStyle = 'hsl(225, 45%, 6%)';
      this.ctx.fillRect(0, 0, this.width, this.height);
      audioEngine.play_transition();
    }
  }

  protected on_cleanup(): void {
    audioEngine.stop_ambience();
    // Event listeners are cleared by GC or should be explicitly removed if persistent
    // Note: BaseEngine cleans up resize/key/click, but we added pointermove/up here.
  }

  private _start_drawing(e: PointerEvent): void {
    this._isDrawing = true;
    const rect = this.canvas.getBoundingClientRect();
    this._lastX = (e.clientX - rect.left);
    this._lastY = (e.clientY - rect.top);
  }

  private _draw(e: PointerEvent): void {
    if (!this._isDrawing) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);

    this.ctx.beginPath();
    this.ctx.moveTo(this._lastX, this._lastY);
    this.ctx.lineTo(x, y);
    this.ctx.strokeStyle = `hsl(${this._hue}, 70%, 50%)`;
    this.ctx.stroke();

    this._lastX = x;
    this._lastY = y;
  }

  private _stop_drawing(): void {
    this._isDrawing = false;
  }

  private _complete(): void {
    // Record a single "perfect" trial
    this.record_trial({
      exerciseType: 'FreeDraw',
      pillar: 'SustainedAttention',
      timestamp: Date.now(),
      difficulty: 1,
      isCorrect: true,
      reactionTimeMs: 0,
      metadata: { sessionType: 'refractory' }
    });
  }
}
