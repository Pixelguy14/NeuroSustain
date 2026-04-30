// ============================================================
// NeuroSustain — Longitudinal Calendar Heatmap (Canvas 2D)
// Visualizes training consistency over the last 12 months.
// GitHub-style contribution graph.
// ============================================================

import type { Session } from '@shared/types.ts';

export function render_calendar_heatmap(
  canvas: HTMLCanvasElement,
  sessions: Session[],
  options: {
    color?: string;
    months?: number;
    locale?: string;
    dayLabels?: string[];
  } = {}
): void {
  const {
    color = 'hsla(175, 70%, 50%, 1)',
    months = 6,
    locale = 'en',
    dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
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

  // Group sessions by date string (YYYY-MM-DD)
  const sessionCounts: Record<string, number> = {};
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    sessionCounts[key] = (sessionCounts[key] || 0) + 1;
  }

  // Calculate time range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Start on a Sunday

  // Calculate grid dimensions
  const weeks = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  const padding = 30;
  
  // Stretch dynamically to fill available width and height precisely
  const cellW = (width - padding) / weeks;
  const cellH = (height - padding) / 7;

  ctx.clearRect(0, 0, width, height);

  // Draw grid
  let currentPos = new Date(startDate);
  let col = 0;
  
  while (currentPos <= endDate) {
    const dayOfWeek = currentPos.getDay();
    const key = `${currentPos.getFullYear()}-${String(currentPos.getMonth() + 1).padStart(2, '0')}-${String(currentPos.getDate()).padStart(2, '0')}`;
    const count = sessionCounts[key] || 0;

    const x = padding + col * cellW;
    const y = dayOfWeek * cellH;

    // Color based on intensity
    if (count > 0) {
      const intensity = Math.min(1, 0.2 + (count * 0.2));
      ctx.fillStyle = color.replace('1)', `${intensity})`);
    } else {
      ctx.fillStyle = 'hsla(225, 30%, 15%, 0.3)';
    }

    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, cellW - 2, cellH - 2, 2);
    ctx.fill();

    if (dayOfWeek === 6) col++;
    currentPos.setDate(currentPos.getDate() + 1);
  }

  // Draw month labels
  ctx.font = '500 9px Inter, sans-serif';
  ctx.fillStyle = 'hsla(220, 15%, 55%, 0.6)';
  
  let labelPos = new Date(startDate);
  let lastMonth = -1;
  let labelCol = 0;

  while (labelPos <= endDate) {
    if (labelPos.getMonth() !== lastMonth) {
      const monthName = labelPos.toLocaleString(locale, { month: 'short' });
      ctx.fillText(monthName, padding + labelCol * cellW, height - 10);
      lastMonth = labelPos.getMonth();
    }
    
    if (labelPos.getDay() === 6) labelCol++;
    labelPos.setDate(labelPos.getDate() + 1);
  }

  // Day labels
  ctx.textAlign = 'right';
  ctx.font = '500 8px Inter, sans-serif';
  for (let i = 0; i < 7; i += 2) {
    ctx.fillText(dayLabels[i]!, padding - 5, i * cellH + cellH / 2);
  }
}
