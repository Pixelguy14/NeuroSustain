// ============================================================
// NeuroSustain — Symbol Search Engine
// Processing Speed + Sustained Attention
//
// A target symbol is shown at the top. The user must tap ALL
// matching symbols in a grid as fast as possible.
//
// Difficulty Scaling:
//   1-3: 3×3 grid, 2-3 targets, low similarity, 10s
//   4-7: 4×4 grid, 3-4 targets, medium similarity, 8s
//   8-10: 4×4 grid, 4-5 targets, high similarity, 6s
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';
import { t } from '@shared/i18n.ts';

type Phase = 'countdown' | 'scanning' | 'feedback';

// ── Shape Definitions (Path2D cache) ──────────────────────

interface ShapeDef {
  name: string;
  build: (size: number) => Path2D;
}

const SHAPES: ShapeDef[] = [
  {
    name: 'circle',
    build: (s) => {
      const p = new Path2D();
      p.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      return p;
    },
  },
  {
    name: 'square',
    build: (s) => {
      const p = new Path2D();
      const m = s * 0.15;
      p.rect(m, m, s - m * 2, s - m * 2);
      return p;
    },
  },
  {
    name: 'triangle',
    build: (s) => {
      const p = new Path2D();
      p.moveTo(s / 2, s * 0.1);
      p.lineTo(s * 0.9, s * 0.85);
      p.lineTo(s * 0.1, s * 0.85);
      p.closePath();
      return p;
    },
  },
  {
    name: 'diamond',
    build: (s) => {
      const p = new Path2D();
      p.moveTo(s / 2, s * 0.1);
      p.lineTo(s * 0.9, s / 2);
      p.lineTo(s / 2, s * 0.9);
      p.lineTo(s * 0.1, s / 2);
      p.closePath();
      return p;
    },
  },
  {
    name: 'cross',
    build: (s) => {
      const p = new Path2D();
      const t = s * 0.2; // thickness
      p.rect(s / 2 - t / 2, s * 0.1, t, s * 0.8);
      p.rect(s * 0.1, s / 2 - t / 2, s * 0.8, t);
      return p;
    },
  },
  {
    name: 'star',
    build: (s) => {
      const p = new Path2D();
      const cx = s / 2, cy = s / 2;
      const outerR = s * 0.42, innerR = s * 0.18;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      return p;
    },
  },
  {
    name: 'arrow',
    build: (s) => {
      const p = new Path2D();
      p.moveTo(s / 2, s * 0.1);
      p.lineTo(s * 0.85, s * 0.5);
      p.lineTo(s * 0.6, s * 0.5);
      p.lineTo(s * 0.6, s * 0.9);
      p.lineTo(s * 0.4, s * 0.9);
      p.lineTo(s * 0.4, s * 0.5);
      p.lineTo(s * 0.15, s * 0.5);
      p.closePath();
      return p;
    },
  },
  {
    name: 'pentagon',
    build: (s) => {
      const p = new Path2D();
      const cx = s / 2, cy = s / 2, r = s * 0.4;
      for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      return p;
    },
  },
  {
    name: 'hexagon',
    build: (s) => {
      const p = new Path2D();
      const cx = s / 2, cy = s / 2, r = s * 0.4;
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      return p;
    },
  },
  {
    name: 'crescent',
    build: (s) => {
      const p = new Path2D();
      const cx = s / 2, cy = s / 2, r = s * 0.4;
      p.arc(cx, cy, r, 0, Math.PI * 2);
      // Cut out an overlapping circle offset to the right
      // Path2D doesn't support 'xor', so draw the outer and inner arcs
      const inner = new Path2D();
      inner.arc(cx + r * 0.4, cy, r * 0.9, 0, Math.PI * 2);
      // We'll draw this as two arcs to fake a crescent
      const p2 = new Path2D();
      p2.arc(cx - s * 0.05, cy, r, Math.PI * 0.35, Math.PI * 1.65);
      p2.arc(cx + s * 0.1, cy, r * 0.7, Math.PI * 1.65, Math.PI * 0.35, true);
      p2.closePath();
      return p2;
    },
  },
  {
    name: 'lightning',
    build: (s) => {
      const p = new Path2D();
      p.moveTo(s * 0.55, s * 0.05);
      p.lineTo(s * 0.3, s * 0.45);
      p.lineTo(s * 0.5, s * 0.45);
      p.lineTo(s * 0.4, s * 0.95);
      p.lineTo(s * 0.7, s * 0.5);
      p.lineTo(s * 0.5, s * 0.5);
      p.closePath();
      return p;
    },
  },
  {
    name: 'heart',
    build: (s) => {
      const p = new Path2D();
      const cx = s / 2, top = s * 0.3;
      p.moveTo(cx, s * 0.85);
      p.bezierCurveTo(s * 0.05, s * 0.55, s * 0.05, s * 0.15, cx, top);
      p.bezierCurveTo(s * 0.95, s * 0.15, s * 0.95, s * 0.55, cx, s * 0.85);
      p.closePath();
      return p;
    },
  },
];

// Similarity pools for difficulty scaling
// Low similarity: shapes look very different
const LOW_SIM_POOL  = [0, 1, 2, 4, 5, 10]; // circle, square, triangle, cross, star, lightning
// Medium: some geometric overlap
const MED_SIM_POOL  = [0, 3, 5, 6, 7, 8, 10]; // circle, diamond, star, arrow, pentagon, hexagon, lightning
// High: subtle variants
const HIGH_SIM_POOL = [0, 3, 7, 8, 9, 11]; // circle, diamond, pentagon, hexagon, crescent, heart

export class SymbolSearchEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'SymbolSearch';
  readonly primaryPillar: CognitivePillar = 'ProcessingSpeed';
  readonly totalTrials: number = 15;
  protected validReactionTimeMax: number = 15000;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;

  // Trial state
  private _cols: number = 3;
  private _rows: number = 3;
  private _grid: number[] = [];             // Flat array of shape indices
  private _targetShapeIndex: number = 0;
  private _targetCells: Set<number> = new Set();
  private _tappedCells: Set<number> = new Set();
  private _correctTaps: number = 0;
  private _falseTaps: number = 0;
  private _timeLimitMs: number = 10000;
  private _isCorrect: boolean = false;
  private _firstTapMs: number = 0;

  // Geometry (pre-computed)
  private _cellSize: number = 0;
  private _gridOffsetX: number = 0;
  private _gridOffsetY: number = 0;

  // Path2D cache (rebuilt when cellSize changes)
  private _cachedPaths: Path2D[] = [];
  private _cachedCellSize: number = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
  }

  protected on_start(): void {
    this._phaseStart = precise_now();
    this.start_countdown(() => this._next_trial());

    // Register click handler
    this.canvas.onclick = (e: MouseEvent) => {
      if (this._phase !== 'scanning') return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Hit test grid
      const col = Math.floor((x - this._gridOffsetX) / this._cellSize);
      const row = Math.floor((y - this._gridOffsetY) / this._cellSize);

      if (col >= 0 && col < this._cols && row >= 0 && row < this._rows) {
        const cellIndex = row * this._cols + col;
        this._handle_tap(cellIndex);
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

      case 'scanning':
        // Auto-submit when all targets found
        if (this._correctTaps === this._targetCells.size) {
          this._submit(true);
        } else if (elapsed >= this._timeLimitMs) {
          this._submit(false);
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
        break;

      case 'scanning':
        this._render_game(ctx, w, h);
        break;

      case 'feedback':
        this._render_game(ctx, w, h);
        this._render_feedback_overlay(ctx, cx, cy);
        break;
    }
  }

  private _render_game(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
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

    // Target indicator at top
    const targetSize = 40;
    ctx.save();
    ctx.translate(w / 2 - targetSize / 2, 85);
    ctx.fillStyle = 'hsla(175, 70%, 55%, 0.9)';
    ctx.fill(this._get_cached_path(this._targetShapeIndex, targetSize));
    ctx.restore();

    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 55%, 0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(t('exercise.setSwitch.findAll'), w / 2, 140);

    // Grid
    const cs = this._cellSize;
    const gap = 4;

    for (let i = 0; i < this._grid.length; i++) {
      const col = i % this._cols;
      const row = Math.floor(i / this._cols);
      const x = this._gridOffsetX + col * cs;
      const y = this._gridOffsetY + row * cs;

      // Cell background
      ctx.beginPath();
      ctx.roundRect(x + gap / 2, y + gap / 2, cs - gap, cs - gap, 6);

      if (this._tappedCells.has(i)) {
        if (this._targetCells.has(i)) {
          // Correct tap — green
          ctx.fillStyle = 'hsla(145, 60%, 20%, 0.6)';
          ctx.fill();
          ctx.strokeStyle = 'hsl(145, 65%, 50%)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          // False tap — red
          ctx.fillStyle = 'hsla(0, 60%, 20%, 0.6)';
          ctx.fill();
          ctx.strokeStyle = 'hsl(0, 65%, 50%)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = 'hsla(225, 30%, 15%, 0.6)';
        ctx.fill();
        ctx.strokeStyle = 'hsla(220, 20%, 35%, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw shape
      const shapeSize = cs - gap - 12;
      ctx.save();
      ctx.translate(x + gap / 2 + 6, y + gap / 2 + 6);
      ctx.fillStyle = this._tappedCells.has(i)
        ? (this._targetCells.has(i) ? 'hsl(145, 65%, 55%)' : 'hsl(0, 65%, 55%)')
        : 'hsla(220, 20%, 75%, 0.8)';
      ctx.fill(this._get_cached_path(this._grid[i]!, shapeSize));
      ctx.restore();
    }
  }

  private _render_feedback_overlay(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.fillStyle = 'hsla(225, 45%, 6%, 0.7)';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.font = 'bold 48px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this._isCorrect) {
      ctx.fillStyle = 'hsl(145, 65%, 55%)';
      ctx.fillText('✓', cx, cy - 20);
    } else {
      ctx.fillStyle = 'hsl(0, 75%, 55%)';
      ctx.fillText('✗', cx, cy - 20);
      ctx.font = '500 16px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 60%, 0.9)';
      ctx.fillText(t('exercise.symbolSearch.found', { count: this._correctTaps, total: this._targetCells.size }), cx, cy + 24);
    }
  }

  protected on_key_down(_code: string, _timestamp: number): void {
    // No keyboard interaction — touch/click only
  }

  protected on_cleanup(): void {
    this.canvas.onclick = null;
  }

  // ── Logic ───────────────────────────────────────────────

  private _get_cached_path(shapeIndex: number, size: number): Path2D {
    // Rebuild cache if cell size changed
    if (size !== this._cachedCellSize || this._cachedPaths.length === 0) {
      this._cachedCellSize = size;
      this._cachedPaths = SHAPES.map(s => s.build(size));
    }
    return this._cachedPaths[shapeIndex] || this._cachedPaths[0]!;
  }

  private _next_trial(): void {
    const diff = this._currentDifficulty;

    // Grid size
    if (diff <= 3) {
      this._cols = 3; this._rows = 3;
    } else {
      this._cols = 4; this._rows = 4;
    }

    const totalCells = this._cols * this._rows;

    // Target count
    let targetCount: number;
    if (diff <= 3) targetCount = 2 + Math.floor(Math.random() * 2);       // 2-3
    else if (diff <= 7) targetCount = 3 + Math.floor(Math.random() * 2);  // 3-4
    else targetCount = 4 + Math.floor(Math.random() * 2);                 // 4-5

    // Select shape pool based on difficulty
    let pool: number[];
    if (diff <= 3) pool = LOW_SIM_POOL;
    else if (diff <= 7) pool = MED_SIM_POOL;
    else pool = HIGH_SIM_POOL;

    // Pick target shape and distractors
    const shuffledPool = [...pool].sort(() => Math.random() - 0.5);
    this._targetShapeIndex = shuffledPool[0]!;

    // Pick 2-3 distractor shapes
    const distractorCount = Math.min(3, shuffledPool.length - 1);
    const distractors = shuffledPool.slice(1, 1 + distractorCount);

    // Build grid
    this._grid = new Array(totalCells);
    this._targetCells = new Set();

    // Place targets at random positions
    const positions = Array.from({ length: totalCells }, (_, i) => i)
      .sort(() => Math.random() - 0.5);

    for (let i = 0; i < targetCount; i++) {
      const pos = positions[i]!;
      this._grid[pos] = this._targetShapeIndex;
      this._targetCells.add(pos);
    }

    // Fill remaining with distractors
    for (let i = targetCount; i < totalCells; i++) {
      const pos = positions[i]!;
      this._grid[pos] = distractors[Math.floor(Math.random() * distractors.length)]!;
    }

    // Geometry
    const maxGridW = this.width - 40;
    const maxGridH = this.height - 200; // Room for target + time bar
    this._cellSize = Math.min(maxGridW / this._cols, maxGridH / this._rows, 80);
    this._gridOffsetX = (this.width - this._cellSize * this._cols) / 2;
    this._gridOffsetY = 155;

    // Time limit
    if (diff <= 3) this._timeLimitMs = 10000;
    else if (diff <= 7) this._timeLimitMs = 8000;
    else this._timeLimitMs = 6000;

    // Reset state
    this._tappedCells = new Set();
    this._correctTaps = 0;
    this._falseTaps = 0;
    this._firstTapMs = 0;

    // Invalidate path cache (cell size may have changed)
    this._cachedCellSize = 0;

    this._phase = 'scanning';
    this._phaseStart = precise_now();
  }

  private _handle_tap(cellIndex: number): void {
    if (this._tappedCells.has(cellIndex)) return; // Already tapped

    this._tappedCells.add(cellIndex);

    if (this._firstTapMs === 0) {
      this._firstTapMs = precise_now() - this._phaseStart;
    }

    if (this._targetCells.has(cellIndex)) {
      this._correctTaps++;
      audioEngine.play_tick();
    } else {
      this._falseTaps++;
      audioEngine.play_error();
    }
  }

  private _submit(allFound: boolean): void {
    const reactionMs = precise_now() - this._phaseStart;
    this._isCorrect = allFound && this._falseTaps === 0;

    if (this._isCorrect) {
      audioEngine.play_correct();
    } else if (!allFound) {
      audioEngine.play_error();
    }

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect: this._isCorrect,
      reactionTimeMs: this._firstTapMs > 0 ? this._firstTapMs : reactionMs,
      metadata: {
        trial: this.currentTrial + 1,
        targetSymbol: SHAPES[this._targetShapeIndex]!.name,
        gridSize: `${this._cols}x${this._rows}`,
        targetCount: this._targetCells.size,
        correctTaps: this._correctTaps,
        falseTaps: this._falseTaps,
        allFound,
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
