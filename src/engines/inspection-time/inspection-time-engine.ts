// ============================================================
// NeuroSustain — Inspection Time Engine ("The Flash")
// Processing Speed (Pure Visual Intake)
//
// Three identical shapes appear. For a brief flash (50-500ms),
// one shape changes subtly. A visual mask replaces the display.
// The user must click where the altered shape was.
//
// This is a classic psychometric test measuring raw visual
// intake speed — before working memory engages.
//
// Difficulty Scaling:
//   1-3: 500ms exposure, large change (30%), simple shapes
//   4-7: 200ms exposure, medium change (15%)
//   8-10: 80ms exposure, subtle change (5%)
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import { t } from '@shared/i18n.ts';

type Phase = 'countdown' | 'fixation' | 'flash' | 'mask' | 'response' | 'feedback';

export class InspectionTimeEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'InspectionTime';
  readonly primaryPillar: CognitivePillar = 'ProcessingSpeed';
  readonly totalTrials: number = 20;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;

  // Trial state
  private _exposureMs: number = 500;
  private _targetPosition: number = 0; // 0, 1, or 2
  private _changeMagnitude: number = 0.3; // Fraction of size change
  private _isCorrect: boolean = false;


  // Geometry (pre-computed per trial)
  private _shapePositions: { x: number; y: number; size: number }[] = [];
  private _btnRects: { x: number; y: number; w: number; h: number }[] = [];
  private _shapeBaseSize: number = 0;

  // Mask noise (pre-generated ImageData, reused across trials)
  private _maskCanvas: HTMLCanvasElement | null = null;

  // Shape type per trial (0 = vertical line, 1 = circle, 2 = square)
  private _shapeType: number = 0;
  private _btnPressMs: Map<number, number> = new Map();
  private _btnGradients: Map<number, CanvasGradient> = new Map();

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._phaseStart = precise_now();
    this.start_countdown(() => this._next_trial());

    // Register click handler for response phase
    this.canvas.onpointerdown = (e: MouseEvent) => {
      if (this._phase !== 'response') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      for (let i = 0; i < this._btnRects.length; i++) {
        const r = this._btnRects[i]!;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          this._btnPressMs.set(i, precise_now());
          this._submit(i);
          return;
        }
      }
    };
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    switch (this._phase) {
      case 'countdown': {
        // Handled by BaseEngine
        break;
      }

      case 'fixation':
        if (elapsed > 500) {
          this._phase = 'flash';
          this._phaseStart = precise_now();
        }
        break;

      case 'flash':
        if (elapsed >= this._exposureMs) {
          this._phase = 'mask';
          this._phaseStart = precise_now();
        }
        break;

      case 'mask':
        if (elapsed > 200) {
          this._phase = 'response';
          this._phaseStart = precise_now();
        }
        break;

      case 'response':
        if (elapsed > 5000) {
          this._submit(-1); // Timeout
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

      case 'fixation':
        this._render_fixation(ctx, cx, cy);
        break;

      case 'flash':
        this._render_shapes(ctx, true);
        break;

      case 'mask':
        this._render_mask(ctx);
        break;

      case 'response':
        this._render_response(ctx, cx, w);
        break;

      case 'feedback':
        this._render_feedback_result(ctx, cx, cy);
        break;
    }
  }

  private _render_fixation(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    // Glass stage behind fixation
    const stageSize = 120;
    this.draw_glass_panel(ctx, cx - stageSize / 2, cy - stageSize / 2, stageSize, stageSize, 20);

    // Fixation cross
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    const size = 12;
    ctx.beginPath();
    ctx.moveTo(cx - size, cy);
    ctx.lineTo(cx + size, cy);
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx, cy + size);
    ctx.stroke();

    ctx.font = '800 10px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(175, 70%, 50%, 0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.patternBreaker.focus').toUpperCase(), cx, cy + 40);
  }

  private _render_shapes(ctx: CanvasRenderingContext2D, showAnomaly: boolean): void {
    const stageW = (this._shapePositions[2]!.x - this._shapePositions[0]!.x) + this._shapeBaseSize + 60;
    const stageH = this._shapeBaseSize + 60;
    this.draw_glass_panel(ctx, (this.width - stageW) / 2, this.height / 2 - stageH / 2, stageW, stageH, 16);

    for (let i = 0; i < 3; i++) {
      const pos = this._shapePositions[i]!;
      const isTarget = showAnomaly && i === this._targetPosition;
      const size = isTarget
        ? this._shapeBaseSize * (1 - this._changeMagnitude)
        : this._shapeBaseSize;

      ctx.fillStyle = 'white';
      ctx.shadowColor = 'hsla(200, 65%, 55%, 0.8)';
      ctx.shadowBlur = 10;

      switch (this._shapeType) {
        case 0: // Vertical line
          ctx.fillRect(
            Math.round(pos.x + (this._shapeBaseSize - 8) / 2),
            Math.round(pos.y + (this._shapeBaseSize - size) / 2),
            8,
            Math.round(size)
          );
          break;

        case 1: // Circle
          ctx.beginPath();
          ctx.arc(
            Math.round(pos.x + this._shapeBaseSize / 2),
            Math.round(pos.y + this._shapeBaseSize / 2),
            Math.round(size / 2),
            0, Math.PI * 2
          );
          ctx.fill();
          break;

        case 2: // Square
          {
            const roundedSize = Math.round(size);
            const offset = Math.round((this._shapeBaseSize - roundedSize) / 2);
            ctx.fillRect(
              Math.round(pos.x + offset),
              Math.round(pos.y + offset),
              roundedSize,
              roundedSize
            );
          }
          break;
      }
      ctx.shadowBlur = 0;
    }
  }

  private _render_mask(ctx: CanvasRenderingContext2D): void {
    // Generate mask noise if needed
    if (!this._maskCanvas || this._maskCanvas.width !== this.width || this._maskCanvas.height !== this.height) {
      this._maskCanvas = document.createElement('canvas');
      this._maskCanvas.width = this.width;
      this._maskCanvas.height = this.height;
      const mctx = this._maskCanvas.getContext('2d')!;
      const idata = mctx.createImageData(this.width, this.height);
      const data = idata.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 60 + 20; // Dark noise
        data[i] = v;       // R
        data[i + 1] = v;   // G
        data[i + 2] = v + 15; // B (slight blue tint)
        data[i + 3] = 255;
      }
      mctx.putImageData(idata, 0, 0);
    }

    // Only draw noise over the shape area
    const minX = Math.max(0, this._shapePositions[0]!.x - 20);
    const maxX = Math.min(this.width, this._shapePositions[2]!.x + this._shapeBaseSize + 20);
    const minY = Math.max(0, this._shapePositions[0]!.y - 20);
    const maxY = Math.min(this.height, this._shapePositions[0]!.y + this._shapeBaseSize + 20);

    // Fill the shape area with a dark base
    ctx.fillStyle = 'hsl(225, 40%, 10%)';
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

    // Apply static noise from offscreen canvas
    if (this._maskCanvas) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(
        this._maskCanvas,
        minX, minY, maxX - minX, maxY - minY,
        minX, minY, maxX - minX, maxY - minY
      );
      ctx.globalAlpha = 1.0;
    }

    // Draw dense geometric pattern
    ctx.strokeStyle = 'hsla(200, 60%, 50%, 0.4)';
    ctx.lineWidth = 2;
    const step = 8;
    for (let x = minX; x < maxX; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, minY);
      ctx.lineTo(x + 20, maxY);
      ctx.stroke();
    }
    for (let x = maxX; x > minX; x -= step) {
      ctx.beginPath();
      ctx.moveTo(x, minY);
      ctx.lineTo(x - 20, maxY);
      ctx.stroke();
    }

    // Outer stage border for the mask
    ctx.strokeStyle = 'hsla(200, 60%, 45%, 0.3)';
    ctx.lineWidth = 4;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  }

  private _render_response(ctx: CanvasRenderingContext2D, cx: number, _w: number): void {
    const cy = this.height / 2;
    ctx.font = '800 10px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(175, 70%, 50%, 0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('exercise.inspectionTime.whichChanged').toUpperCase(), cx, cy - 80);

    // Three response buttons
    const now = precise_now();
    for (let i = 0; i < 3; i++) {
      const r = this._btnRects[i]!;
      const isPressed = now - (this._btnPressMs.get(i) || 0) < 100;

      this.draw_tactile_button(
          ctx, r.x, r.y, r.w, r.h,
          ['◀', '●', '▶'][i]!,
          {
              bg: (this._btnGradients.get(i) || 'hsla(225, 30%, 15%, 0.8)') as any,
              stroke: isPressed ? 'white' : 'hsla(200, 60%, 45%, 0.4)',
              text: isPressed ? 'white' : 'hsl(200, 65%, 60%)'
          },
          isPressed
      );

      // Position label
      ctx.font = '800 8px Outfit, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 50%, 0.4)';
      const posLabel = [t('exercise.inspectionTime.left'), t('exercise.inspectionTime.center'), t('exercise.inspectionTime.right')][i]!;
      ctx.fillText(posLabel.toUpperCase(), r.x + r.w / 2, r.y + r.h + 12);
    }

    // Keyboard hints
    ctx.font = '800 9px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 50%, 0.3)';
    ctx.fillText('[1]          [2]          [3]', cx, this._btnRects[0]!.y + this._btnRects[0]!.h + 30);
  }

  private _render_feedback_result(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const progress = (precise_now() - this._phaseStart) / 1500;
    this.draw_feedback_orb(ctx, cx, cy, this._isCorrect, progress);

    if (!this._isCorrect) {
      ctx.font = '800 11px Outfit, sans-serif';
      ctx.fillStyle = 'hsla(0, 0%, 100%, 0.6)';
      ctx.textAlign = 'center';
      const pos = [t('exercise.inspectionTime.left'), t('exercise.inspectionTime.center'), t('exercise.inspectionTime.right')][this._targetPosition]!;
      ctx.fillText(
        t('exercise.inspectionTime.result', { pos }).toUpperCase(),
        cx, cy + this.lastOrbRadius + 20
      );
    }

    // Show exposure info
    ctx.font = '800 9px Outfit, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 45%, 0.4)';
    ctx.fillText(`FLASH EXPOSURE: ${this._exposureMs}MS`, cx, cy + this.lastOrbRadius + 36);
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'response') return;

    const match = code.match(/^(?:Digit|Numpad)([123])$/);
    if (match) {
      const idx = parseInt(match[1]!, 10) - 1;
      this._btnPressMs.set(idx, precise_now());
      this._submit(idx);
    }
  }

  protected on_cleanup(): void {
    this.canvas.onpointerdown = null;
    this._maskCanvas = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _next_trial(): void {
    const diff = this._currentDifficulty;

    // Exposure time — the critical variable
    if (diff <= 3) this._exposureMs = 500 - (diff - 1) * 50;       // 500, 450, 400
    else if (diff <= 7) this._exposureMs = 300 - (diff - 4) * 25;  // 300, 275, 250, 225
    else this._exposureMs = 150 - (diff - 8) * 35;                 // 150, 115, 80

    // Ensure minimum exposure
    this._exposureMs = Math.max(50, this._exposureMs);

    // Change magnitude — how much the target shape differs
    if (diff <= 3) this._changeMagnitude = 0.30;
    else if (diff <= 7) this._changeMagnitude = 0.15;
    else this._changeMagnitude = 0.08;

    // Shape type (rotate for variety)
    this._shapeType = Math.floor(Math.random() * 3);

    // Target position (0, 1, 2)
    this._targetPosition = Math.floor(Math.random() * 3);

    // Compute shape positions (horizontally centered)
    this._shapeBaseSize = Math.min(80, this.width * 0.15);
    const gap = this._shapeBaseSize * 0.6;
    const totalW = 3 * this._shapeBaseSize + 2 * gap;
    const startX = (this.width - totalW) / 2;
    const shapeY = this.height / 2 - this._shapeBaseSize / 2;

    this._shapePositions = [];
    for (let i = 0; i < 3; i++) {
      this._shapePositions.push({
        x: startX + i * (this._shapeBaseSize + gap),
        y: shapeY,
        size: this._shapeBaseSize,
      });
    }

    // Compute response button geometry
    const btnW = Math.min(100, this.width * 0.25);
    const btnH = 60;
    const btnGap = 20;
    const btnTotalW = 3 * btnW + 2 * btnGap;
    const btnStartX = (this.width - btnTotalW) / 2;
    const btnY = this.height / 2 + 10;

    this._btnRects = [];
    this._btnGradients.clear();
    for (let i = 0; i < 3; i++) {
      const rx = btnStartX + i * (btnW + btnGap);
      this._btnRects.push({
        x: rx,
        y: btnY,
        w: btnW,
        h: btnH,
      });

      const grad = this.ctx.createLinearGradient(rx, btnY, rx, btnY + btnH);
      grad.addColorStop(0, 'hsla(225, 30%, 20%, 0.8)');
      grad.addColorStop(1, 'hsla(225, 30%, 10%, 0.9)');
      this._btnGradients.set(i, grad);
    }



    // Start with fixation
    this._phase = 'fixation';
    this._phaseStart = precise_now();
  }

  private _submit(choice: number): void {
    this._isCorrect = choice === this._targetPosition;
    const reactionMs = precise_now() - this._phaseStart;

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
        exposureMs: this._exposureMs,
        targetPosition: this._targetPosition,
        userChoice: choice,
        changeMagnitude: this._changeMagnitude,
        shapeType: this._shapeType,
        timedOut: choice < 0,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
