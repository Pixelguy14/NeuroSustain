// ============================================================
// NeuroSustain — Free Draw Engine
// Refractory Mode — non-scored DMN activation session
//
// Triggered when cognitive fatigue is detected. 60 seconds of
// unguided creative flow with procedural color cycling.
//
// Polish (Sprint 7):
//   - Smooth quadratic Bezier curve interpolation
//   - Pressure-sensitive line width (stylus/tablet)
//   - Proper pointer event cleanup (no memory leaks)
//   - Visual "C — Clear" pill in HUD
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
  private _prevX: number = 0;
  private _prevY: number = 0;
  private _hue: number = 0;
  private _timer: number = 60;
  private _startTime: number = 0;

  // Stored handler references for proper cleanup
  private _onPointerDown: ((e: PointerEvent) => void) | null = null;
  private _onPointerMove: ((e: PointerEvent) => void) | null = null;
  private _onPointerUp: (() => void) | null = null;

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

    // Pointer events for drawing — store references for cleanup
    this._onPointerDown = (e: PointerEvent) => this._start_drawing(e);
    this._onPointerMove = (e: PointerEvent) => this._draw(e);
    this._onPointerUp = () => this._stop_drawing();

    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

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

    // Timer bar at bottom (Clear area first to prevent smearing)
    const barH = 4;
    const progress = this._timer / 60;
    ctx.clearRect(0, this.height - barH, this.width, barH);
    ctx.fillStyle = 'hsla(220, 20%, 20%, 0.5)';
    ctx.fillRect(0, this.height - barH, this.width, barH);
    ctx.fillStyle = `hsl(${this._hue}, 70%, 50%)`;
    ctx.fillRect(0, this.height - barH, this.width * progress, barH);

    // Fade top HUD (Clear area first to prevent smearing)
    ctx.save();
    const hudY = 60;
    ctx.clearRect(0, 0, this.width, hudY);
    ctx.fillStyle = 'hsla(225, 45%, 6%, 0.85)';
    ctx.fillRect(0, 0, this.width, hudY);
    
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 70%, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('REFRACTORY SESSION — FREE FLOW', this.width / 2, 25);

    // "C — Clear" pill
    const pillW = 90;
    const pillH = 24;
    const pillX = this.width / 2 - pillW / 2;
    const pillY = 38;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'hsla(225, 30%, 15%, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'hsla(220, 20%, 40%, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C  Clear', this.width / 2, pillY + pillH / 2);

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

    // Proper pointer event cleanup — no memory leaks
    if (this._onPointerDown) {
      this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    }
    if (this._onPointerMove) {
      this.canvas.removeEventListener('pointermove', this._onPointerMove);
    }
    if (this._onPointerUp) {
      window.removeEventListener('pointerup', this._onPointerUp);
    }
    this._onPointerDown = null;
    this._onPointerMove = null;
    this._onPointerUp = null;
  }

  private _start_drawing(e: PointerEvent): void {
    this._isDrawing = true;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / (rect.width * this.dpr);
    const scaleY = this.canvas.height / (rect.height * this.dpr);
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    this._lastX = x;
    this._lastY = y;
    this._prevX = x;
    this._prevY = y;
  }

  private _draw(e: PointerEvent): void {
    if (!this._isDrawing) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / (rect.width * this.dpr);
    const scaleY = this.canvas.height / (rect.height * this.dpr);
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Pressure-sensitive line width
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    this.ctx.lineWidth = 1 + pressure * 7;

    // Smooth quadratic Bezier using midpoint-to-midpoint interpolation
    const midX = (this._lastX + x) / 2;
    const midY = (this._lastY + y) / 2;

    this.ctx.beginPath();
    this.ctx.moveTo(this._prevX, this._prevY);
    this.ctx.quadraticCurveTo(this._lastX, this._lastY, midX, midY);
    this.ctx.strokeStyle = `hsl(${this._hue}, 70%, 50%)`;
    this.ctx.stroke();

    this._prevX = midX;
    this._prevY = midY;
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
