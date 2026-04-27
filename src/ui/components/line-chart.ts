// ============================================================
// NeuroSustain — Line Chart Component (Canvas)
// Renders daily averages with a shaded SD area for longitudinal
// tracking. Optimized for zero dependencies.
// ============================================================

import type { DailyAggregate } from '@shared/db.ts';

interface ChartOptions {
  metric: 'meanFocusScore' | 'meanAccuracy' | 'meanRT';
  color: string;
  label: string;
  isInverse?: boolean;
  locale?: string;
}

/**
 * Render a line graph with a shaded SD area.
 * Expects the canvas to have logical dimensions set via CSS,
 * and will set its physical pixel dimensions internally based on DPR.
 */
export function render_line_chart(
  canvas: HTMLCanvasElement,
  data: DailyAggregate[],
  options: ChartOptions
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const parent = canvas.parentElement;
  if (!parent) return;

  const dpr = window.devicePixelRatio || 1;
  const width = parent.clientWidth;
  const height = parent.clientHeight || 150; // default height if missing

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Layout constants
  const PADDING_TOP = 20;
  const PADDING_BOTTOM = 30;
  const PADDING_LEFT = 40;
  const PADDING_RIGHT = 10;
  const PLOT_W = width - PADDING_LEFT - PADDING_RIGHT;
  const PLOT_H = height - PADDING_TOP - PADDING_BOTTOM;

  if (data.length === 0) return;

  // Determine Data Bounds
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (const d of data) {
    let val = d[options.metric];
    let sd = options.metric === 'meanRT' ? d.sdRT : 0; // only use SD for RT right now, or compute SD for others if we had it.
    
    // For Focus and Accuracy, we don't have per-session SD calculated, just 0 right now. 
    // We will simulate a small SD area for visual consistency if SD is 0, or just draw the line.
    
    minVal = Math.min(minVal, val - sd);
    maxVal = Math.max(maxVal, val + sd);
  }

  // Add 10% padding to bounds
  const range = maxVal - minVal;
  minVal -= range * 0.1;
  maxVal += range * 0.1;

  // Hard limits
  if (options.metric === 'meanAccuracy') {
    minVal = Math.max(0, minVal);
    maxVal = Math.min(1, maxVal);
  } else if (minVal === maxVal) {
    minVal -= 10;
    maxVal += 10;
  }

  // Draw Axes
  ctx.strokeStyle = 'hsla(220, 20%, 40%, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING_LEFT, PADDING_TOP);
  ctx.lineTo(PADDING_LEFT, height - PADDING_BOTTOM);
  ctx.lineTo(width - PADDING_RIGHT, height - PADDING_BOTTOM);
  ctx.stroke();

  // Helper functions
  const mapX = (i: number) => PADDING_LEFT + (i / (Math.max(1, data.length - 1))) * PLOT_W;
  const mapY = (val: number) => {
    const normalized = (val - minVal) / (maxVal - minVal);
    return height - PADDING_BOTTOM - (normalized * PLOT_H);
  };

  // Draw Y-Axis Labels
  ctx.fillStyle = 'hsla(220, 15%, 60%, 0.8)';
  ctx.font = '500 10px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  const ticks = 3;
  for (let i = 0; i <= ticks; i++) {
    const val = minVal + (maxVal - minVal) * (i / ticks);
    const y = mapY(val);
    let labelText = '';
    if (options.metric === 'meanAccuracy') labelText = `${Math.round(val * 100)}%`;
    else if (options.metric === 'meanRT') labelText = `${Math.round(val)}ms`;
    else labelText = `${Math.round(val)}`;
    
    ctx.fillText(labelText, PADDING_LEFT - 8, y);
    
    // Grid line
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT, y);
    ctx.lineTo(width - PADDING_RIGHT, y);
    ctx.strokeStyle = 'hsla(220, 20%, 40%, 0.1)';
    ctx.stroke();
  }

  // Draw X-Axis Labels (Dates)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = Math.min(data.length, 5);
  for (let i = 0; i < xTicks; i++) {
    const dataIdx = Math.floor(i * (data.length - 1) / Math.max(1, xTicks - 1));
    const d = data[dataIdx];
    if (!d) continue;
    const x = mapX(dataIdx);
    // Format date based on locale
    const parts = d.date.substring(5).split('-'); // [MM, DD]
    const dateStr = options.locale === 'es' 
      ? `${parts[1]}/${parts[0]}` // DD/MM
      : `${parts[0]}/${parts[1]}`; // MM/DD
    ctx.fillText(dateStr, x, height - PADDING_BOTTOM + 8);
  }

  // Draw SD Area (Shaded)
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    const val = d[options.metric];
    const sd = options.metric === 'meanRT' ? d.sdRT : 0;
    const x = mapX(i);
    const yTop = mapY(val + sd);
    if (i === 0) ctx.moveTo(x, yTop);
    else ctx.lineTo(x, yTop);
  }
  for (let i = data.length - 1; i >= 0; i--) {
    const d = data[i]!;
    const val = d[options.metric];
    const sd = options.metric === 'meanRT' ? d.sdRT : 0;
    const x = mapX(i);
    const yBottom = mapY(val - sd);
    ctx.lineTo(x, yBottom);
  }
  ctx.closePath();
  ctx.fillStyle = `${options.color.replace('hsl', 'hsla').replace(')', ', 0.15)')}`;
  ctx.fill();

  // Draw Main Line
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    const val = d[options.metric];
    const x = mapX(i);
    const y = mapY(val);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Draw Points
  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    const val = d[options.metric];
    const x = mapX(i);
    const y = mapY(val);
    
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(225, 30%, 15%, 1)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = options.color;
    ctx.stroke();
  }

  // Draw Label Title
  ctx.fillStyle = 'hsla(220, 15%, 80%, 1)';
  ctx.font = '600 12px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(options.label, PADDING_LEFT, 4);
}
