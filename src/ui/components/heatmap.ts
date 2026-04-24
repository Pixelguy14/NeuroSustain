// ============================================================
// NeuroSustain — Cognitive Heatmap Component (Canvas 2D)
// Performance visualization: Day of Week vs. Hour of Day
// ============================================================

import type { Session } from '@shared/types.ts';

export function render_performance_heatmap(
  canvas: HTMLCanvasElement,
  sessions: Session[],
  options: {
    metric?: 'focusScore' | 'accuracy' | 'meanReactionTimeMs';
    colorScale?: string[];
  } = {}
): void {
  const {
    metric = 'focusScore',
    colorScale = ['hsla(225, 30%, 15%, 0.4)', 'hsla(175, 70%, 50%, 0.4)', 'hsla(175, 70%, 50%, 0.8)']
  } = options;

  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // 7 days x 24 hours
  const grid: { count: number; sum: number }[][] = Array.from({ length: 7 }, () => 
    Array.from({ length: 24 }, () => ({ count: 0, sum: 0 }))
  );

  for (const s of sessions) {
    const date = new Date(s.startedAt);
    const day = date.getDay(); // 0 = Sunday
    const hour = date.getHours();
    
    grid[day]![hour]!.count++;
    grid[day]![hour]!.sum += s[metric];
  }

  const padding = 30;
  const cellW = (width - padding) / 24;
  const cellH = (height - padding) / 7;

  ctx.clearRect(0, 0, width, height);

  // Draw cells
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = grid[d]![h]!;
      const x = padding + h * cellW;
      const y = d * cellH;

      if (cell.count > 0) {
        const avg = cell.sum / cell.count;
        // Normalize avg (Focus is 0-10, Accuracy 0-1, RT 200-2000)
        let intensity = 0;
        if (metric === 'focusScore') intensity = avg / 10;
        else if (metric === 'accuracy') intensity = avg;
        else intensity = Math.max(0, 1 - (avg - 250) / 1000);

        // Use colorScale if provided, otherwise default to teal
        const baseColor = colorScale[1] || 'hsla(175, 70%, 50%, 0.4)';
        ctx.fillStyle = baseColor.replace('0.4', String(0.1 + intensity * 0.8));
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, cellW - 2, cellH - 2, 2);
        ctx.fill();
      } else {
        ctx.fillStyle = colorScale[0] || 'hsla(225, 30%, 15%, 0.2)';
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, cellW - 2, cellH - 2, 2);
        ctx.fill();
      }
    }
  }

  // Draw labels
  ctx.font = '500 8px Inter, sans-serif';
  ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let d = 0; d < 7; d++) {
    ctx.fillText(dayLabels[d]!, padding - 5, d * cellH + cellH / 2);
  }

  ctx.textAlign = 'center';
  for (let h = 0; h < 24; h += 3) {
    ctx.fillText(`${h}h`, padding + h * cellW + cellW / 2, height - 10);
  }
}
