// ============================================================
// NeuroSustain — Pattern Breaker Engine
// Sustained Attention + Processing Speed
//
// A dense grid of identical shapes is displayed. One shape has
// a subtle anomaly (rotation, color shift, scale, flip, missing
// element, or internal count difference). The user must find it.
//
// Uses hybrid Procedural + JSON recipe approach:
//   - JSON defines anomaly categories and magnitude ranges
//   - Engine procedurally generates grid, position, and magnitude
//
// Difficulty Scaling:
//   1-3: 5×5 grid, large anomaly (20-30%), 15s
//   4-7: 8×8 grid, medium anomaly (10-15%), 12s
//   8-10: 10×10 grid, subtle anomaly (3-8%), 10s
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'countdown' | 'scanning' | 'feedback';

// Anomaly types that the engine can procedurally generate
type AnomalyType = 'rotation' | 'colorShift' | 'scale' | 'missingElement' | 'count';

// ── Base shape builder (all shapes are drawn with Path2D) ──

function build_base_shape(type: number, size: number): Path2D {
  const p = new Path2D();
  const hs = size / 2;
  switch (type) {
    case 0: // Pentagon with center dot
      for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const x = hs + hs * 0.8 * Math.cos(angle);
        const y = hs + hs * 0.8 * Math.sin(angle);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      // Center dot (relative sizing)
      const dotR = size * 0.08;
      p.moveTo(hs + dotR, hs);
      p.arc(hs, hs, dotR, 0, Math.PI * 2);
      break;
    case 1: // Arrow pointing up with line
      p.moveTo(hs, size * 0.1);
      p.lineTo(size * 0.8, size * 0.45);
      p.lineTo(size * 0.6, size * 0.45);
      p.lineTo(size * 0.6, size * 0.9);
      p.lineTo(size * 0.4, size * 0.9);
      p.lineTo(size * 0.4, size * 0.45);
      p.lineTo(size * 0.2, size * 0.45);
      p.closePath();
      break;
    case 2: // Cross with 4 dots
      {
        const t = size * 0.18;
        p.rect(hs - t / 2, size * 0.1, t, size * 0.8);
        p.rect(size * 0.1, hs - t / 2, size * 0.8, t);
        // 4 corner dots (relative sizing)
        const dotR = size * 0.05;
        const corners = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
        for (const [cx, cy] of corners) {
          p.moveTo(size * cx! + dotR, size * cy!);
          p.arc(size * cx!, size * cy!, dotR, 0, Math.PI * 2);
        }
      }
      break;
    case 3: // Diamond
      p.moveTo(hs, size * 0.08);
      p.lineTo(size * 0.92, hs);
      p.lineTo(hs, size * 0.92);
      p.lineTo(size * 0.08, hs);
      p.closePath();
      break;
    default: // Hexagon
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const x = hs + hs * 0.8 * Math.cos(angle);
        const y = hs + hs * 0.8 * Math.sin(angle);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      break;
  }
  return p;
}

export class PatternBreakerEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'PatternBreaker';
  readonly primaryPillar: CognitivePillar = 'SustainedAttention';
  readonly totalTrials: number = 15;
  protected validReactionTimeMax: number = 20000;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;
  private _countdownValue: number = 3;

  // Grid
  private _cols: number = 5;
  private _rows: number = 5;
  private _cellSize: number = 0;
  private _gridOffsetX: number = 0;
  private _gridOffsetY: number = 0;

  // Anomaly
  private _anomalyCell: number = 0;
  private _anomalyType: AnomalyType = 'rotation';
  private _anomalyMagnitude: number = 0;
  private _baseShapeType: number = 0;

  // Path2D cache
  private _basePath: Path2D | null = null;
  private _anomalyPath: Path2D | null = null;
  private _baseColor: string = 'hsl(200, 65%, 55%)';
  private _anomalyColor: string = 'hsl(200, 65%, 55%)';
  private _anomalyRotation: number = 0;
  private _anomalyScale: number = 1;

  // State
  private _timeLimitMs: number = 15000;
  private _isCorrect: boolean = false;
  private _firstClickMs: number = 0;
  private _userClickedCell: number = -1;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phase = 'countdown';
    this._countdownValue = 3;
    this._phaseStart = precise_now();

    this.canvas.onclick = (e: MouseEvent) => {
      if (this._phase !== 'scanning') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const col = Math.floor((x - this._gridOffsetX) / this._cellSize);
      const row = Math.floor((y - this._gridOffsetY) / this._cellSize);

      if (col >= 0 && col < this._cols && row >= 0 && row < this._rows) {
        const cell = row * this._cols + col;
        this._handle_click(cell);
      }
    };
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

      case 'scanning':
        if (elapsed >= this._timeLimitMs) {
          this._submit(-1);
        }
        break;

      case 'feedback':
        if (elapsed > 2000) {
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

      case 'scanning':
        this._render_grid(ctx, w);
        break;

      case 'feedback':
        this._render_grid(ctx, w);
        this._render_feedback(ctx, cx, cy);
        break;
    }
  }

  private _render_grid(ctx: CanvasRenderingContext2D, w: number): void {
    const elapsed = precise_now() - this._phaseStart;

    // Time bar
    if (this._phase === 'scanning') {
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
    }

    // Instruction
    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('Find the different one', w / 2, 90);

    // Draw each cell
    const cs = this._cellSize;
    const shapeSize = cs * 0.7;
    const padding = (cs - shapeSize) / 2;
    const totalCells = this._cols * this._rows;

    for (let i = 0; i < totalCells; i++) {
      const col = i % this._cols;
      const row = Math.floor(i / this._cols);
      const x = this._gridOffsetX + col * cs;
      const y = this._gridOffsetY + row * cs;

      const isAnomaly = i === this._anomalyCell;

      ctx.save();
      ctx.translate(x + padding + shapeSize / 2, y + padding + shapeSize / 2);

      if (isAnomaly) {
        // Apply anomaly transforms
        if (this._anomalyRotation !== 0) {
          ctx.rotate(this._anomalyRotation * Math.PI / 180);
        }
        if (this._anomalyScale !== 1) {
          ctx.scale(this._anomalyScale, this._anomalyScale);
        }

        ctx.translate(-shapeSize / 2, -shapeSize / 2);
        ctx.fillStyle = this._anomalyColor;
        ctx.fill(this._anomalyPath || this._basePath!, 'evenodd');
      } else {
        ctx.translate(-shapeSize / 2, -shapeSize / 2);
        ctx.fillStyle = this._baseColor;
        ctx.fill(this._basePath!, 'evenodd');
      }

      ctx.restore();

      // Highlight clicked cell in feedback
      if (this._phase === 'feedback') {
        if (i === this._userClickedCell) {
          ctx.strokeStyle = this._isCorrect ? 'hsl(145, 65%, 50%)' : 'hsl(0, 65%, 50%)';
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
        }
        if (i === this._anomalyCell && i !== this._userClickedCell) {
          // Show where the anomaly was
          ctx.strokeStyle = 'hsla(45, 80%, 55%, 0.8)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
          ctx.setLineDash([]);
        }
      }
    }
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.fillStyle = 'hsla(225, 45%, 6%, 0.6)';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.font = 'bold 48px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText('✗', cx, cy);
    }
  }

  protected on_key_down(_code: string, _timestamp: number): void {
    // Click/touch only
  }

  protected on_cleanup(): void {
    this.canvas.onclick = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _next_trial(): void {
    const diff = this._currentDifficulty;

    // Grid size (more gradual scaling)
    if (diff <= 2) { this._cols = 4; this._rows = 4; }
    else if (diff <= 4) { this._cols = 5; this._rows = 5; }
    else if (diff <= 6) { this._cols = 6; this._rows = 6; }
    else if (diff <= 8) { this._cols = 8; this._rows = 8; }
    else { this._cols = 10; this._rows = 10; }

    const totalCells = this._cols * this._rows;

    // Pick base shape (rotate per trial for variety)
    this._baseShapeType = Math.floor(Math.random() * 5);

    // Compute geometry
    const maxGridW = this.width - 30;
    const maxGridH = this.height - 130;
    this._cellSize = Math.min(maxGridW / this._cols, maxGridH / this._rows);
    this._gridOffsetX = (this.width - this._cellSize * this._cols) / 2;
    this._gridOffsetY = 105;

    // Build base path
    const shapeSize = this._cellSize * 0.7;
    this._basePath = build_base_shape(this._baseShapeType, shapeSize);

    // Pick anomaly cell
    this._anomalyCell = Math.floor(Math.random() * totalCells);

    // Pick anomaly type
    const types: AnomalyType[] = ['rotation', 'colorShift', 'scale', 'missingElement', 'count'];
    this._anomalyType = types[Math.floor(Math.random() * types.length)]!;

    // Compute anomaly magnitude based on difficulty (higher diff = subtler anomaly)
    const diffFactor = 1 - (diff - 1) / 9; // 1.0 at diff 1, 0.0 at diff 10

    // Reset transforms
    this._anomalyRotation = 0;
    this._anomalyScale = 1;
    this._anomalyPath = null;
    this._baseColor = 'hsl(200, 65%, 55%)';
    this._anomalyColor = 'hsl(200, 65%, 55%)';

    switch (this._anomalyType) {
      case 'rotation':
        // 8° (hard) to 22° (easy) - avoids pop-out effect
        this._anomalyMagnitude = 8 + diffFactor * 14;
        this._anomalyRotation = this._anomalyMagnitude * (Math.random() > 0.5 ? 1 : -1);
        break;

      case 'colorShift': {
        // 10 (subtle) to 25 (noticeable) hue delta
        const hueDelta = 10 + diffFactor * 15;
        this._anomalyMagnitude = hueDelta;
        this._anomalyColor = `hsl(${200 + hueDelta}, 65%, 55%)`;
        break;
      }

      case 'scale':
        // Scale DOWNWARDS (0.75 to 0.9) to stay inside cell bounds
        this._anomalyMagnitude = 0.9 - diffFactor * 0.15;
        this._anomalyScale = this._anomalyMagnitude;
        break;

      case 'missingElement':
        // Build a variant shape with one part missing
        this._anomalyMagnitude = 1;
        this._anomalyPath = this._build_anomaly_path(this._baseShapeType, shapeSize, 'missing');
        break;

      case 'count':
        this._anomalyMagnitude = 1;
        this._anomalyPath = this._build_anomaly_path(this._baseShapeType, shapeSize, 'count');
        break;
    }

    // Time limit
    if (diff <= 3) this._timeLimitMs = 15000;
    else if (diff <= 7) this._timeLimitMs = 12000;
    else this._timeLimitMs = 10000;

    // Reset
    this._firstClickMs = 0;
    this._userClickedCell = -1;

    this._phase = 'scanning';
    this._phaseStart = precise_now();
  }

  private _build_anomaly_path(baseType: number, size: number, mode: 'missing' | 'count'): Path2D {
    const p = new Path2D();
    const hs = size / 2;
    
    switch (baseType) {
      case 0: // Pentagon + Center Dot
        for (let i = 0; i < 5; i++) {
          const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
          const x = hs + hs * 0.8 * Math.cos(angle);
          const y = hs + hs * 0.8 * Math.sin(angle);
          if (i === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        }
        p.closePath();
        if (mode === 'count') {
          // Add a SECOND dot for 'count' anomaly (relative)
          const dotR = size * 0.06;
          p.moveTo(hs - dotR, hs - dotR);
          p.arc(hs - dotR * 1.5, hs - dotR * 1.5, dotR, 0, Math.PI * 2);
          p.moveTo(hs + dotR, hs + dotR);
          p.arc(hs + dotR * 1.5, hs + dotR * 1.5, dotR, 0, Math.PI * 2);
        } else {
          // Missing dot for 'missing' anomaly
        }
        break;

      case 1: // Arrow
        p.moveTo(hs, size * 0.1);
        p.lineTo(size * 0.8, size * 0.45);
        p.lineTo(size * 0.6, size * 0.45);
        p.lineTo(size * 0.6, size * 0.9);
        p.lineTo(size * 0.4, size * 0.9);
        p.lineTo(size * 0.4, size * 0.45);
        p.lineTo(size * 0.2, size * 0.45);
        p.closePath();
        if (mode === 'missing') {
          // Cut a hole in the arrow (relative)
          const holeSize = size * 0.15;
          p.moveTo(hs + holeSize, hs + holeSize);
          p.rect(hs - holeSize / 2, hs + size * 0.2, holeSize, holeSize);
        } else {
          // Add a line to the arrow
          p.moveTo(size * 0.1, size * 0.9);
          p.lineTo(size * 0.9, size * 0.9);
        }
        break;

      case 2: // Cross + dots
        {
          const t = size * 0.18;
          p.rect(hs - t / 2, size * 0.1, t, size * 0.8);
          p.rect(size * 0.1, hs - t / 2, size * 0.8, t);
          const corners = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
          if (mode === 'missing') {
            // Only 3 dots
            const dotR = size * 0.06;
            for (let i = 0; i < 3; i++) {
              const [cx, cy] = corners[i]!;
              p.moveTo(size * cx! + dotR, size * cy!);
              p.arc(size * cx!, size * cy!, dotR, 0, Math.PI * 2);
            }
          } else {
            // Larger dots
            const dotR = size * 0.1;
            for (const [cx, cy] of corners) {
              p.moveTo(size * cx! + dotR, size * cy!);
              p.arc(size * cx!, size * cy!, dotR, 0, Math.PI * 2);
            }
          }
        }
        break;

      default: // Diamond or Hexagon
        // Generic: just add a tiny internal circle
        const largeDotR = size * 0.12;
        const smallDotR = size * 0.06;
        if (mode === 'count') {
          p.moveTo(hs + largeDotR, hs);
          p.arc(hs, hs, largeDotR, 0, Math.PI * 2);
        } else {
          p.moveTo(hs + smallDotR, hs);
          p.arc(hs, hs, smallDotR, 0, Math.PI * 2);
        }
        break;
    }
    return p;
  }

  private _handle_click(cell: number): void {
    if (this._firstClickMs === 0) {
      this._firstClickMs = precise_now() - this._phaseStart;
    }
    this._submit(cell);
  }

  private _submit(clickedCell: number): void {
    this._userClickedCell = clickedCell;
    this._isCorrect = clickedCell === this._anomalyCell;
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
      reactionTimeMs: this._firstClickMs > 0 ? this._firstClickMs : reactionMs,
      metadata: {
        trial: this.currentTrial + 1,
        gridSize: `${this._cols}x${this._rows}`,
        anomalyType: this._anomalyType,
        anomalyMagnitude: Math.round(this._anomalyMagnitude * 100) / 100,
        anomalyCell: this._anomalyCell,
        userCell: clickedCell,
        timedOut: clickedCell < 0,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
