// ============================================================
// NeuroSustain — Radar Chart (Canvas 2D)
// 5-axis cognitive profile visualization
// ============================================================

import type { CognitivePillar } from '@shared/types.ts';
import { ALL_PILLARS, PILLAR_META } from '@shared/constants.ts';
import { t } from '@shared/i18n.ts';

interface RadarData {
  values: Record<CognitivePillar, number>; // 0.0 - 1.0 normalized
}

export function render_radar_chart(
  canvas: HTMLCanvasElement,
  data: RadarData | null,
  size: number = 320
): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size * 0.36;
  const levels = 5;

  // Clear
  ctx.clearRect(0, 0, size, size);

  // Draw concentric pentagons (grid)
  for (let level = 1; level <= levels; level++) {
    const r = (maxRadius / levels) * level;
    ctx.beginPath();
    for (let i = 0; i < ALL_PILLARS.length; i++) {
      const angle = ((Math.PI * 2) / ALL_PILLARS.length) * i - Math.PI / 2;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsla(220, 20%, 30%, ${level === levels ? 0.4 : 0.15})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw axis lines
  for (let i = 0; i < ALL_PILLARS.length; i++) {
    const angle = ((Math.PI * 2) / ALL_PILLARS.length) * i - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxRadius, cy + Math.sin(angle) * maxRadius);
    ctx.strokeStyle = 'hsla(220, 20%, 30%, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw data polygon (if data exists)
  if (data) {
    ctx.beginPath();
    for (let i = 0; i < ALL_PILLARS.length; i++) {
      const pillar = ALL_PILLARS[i]!;
      const value = data.values[pillar] ?? 0;
      const angle = ((Math.PI * 2) / ALL_PILLARS.length) * i - Math.PI / 2;
      const r = maxRadius * Math.max(0.05, value);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Fill with gradient
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
    gradient.addColorStop(0, 'hsla(175, 70%, 50%, 0.25)');
    gradient.addColorStop(1, 'hsla(210, 70%, 58%, 0.08)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke
    ctx.strokeStyle = 'hsla(175, 70%, 50%, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw vertex dots
    for (let i = 0; i < ALL_PILLARS.length; i++) {
      const pillar = ALL_PILLARS[i]!;
      const value = data.values[pillar] ?? 0;
      const angle = ((Math.PI * 2) / ALL_PILLARS.length) * i - Math.PI / 2;
      const r = maxRadius * Math.max(0.05, value);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = PILLAR_META[pillar].color;
      ctx.fill();

      // Glow
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      const glow = ctx.createRadialGradient(x, y, 2, x, y, 8);
      glow.addColorStop(0, PILLAR_META[pillar].color.replace(')', ', 0.4)').replace('hsl(', 'hsla('));
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fill();
    }
  }

  // Draw labels
  ctx.font = `500 ${11}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < ALL_PILLARS.length; i++) {
    const pillar = ALL_PILLARS[i]!;
    const meta = PILLAR_META[pillar];
    const angle = ((Math.PI * 2) / ALL_PILLARS.length) * i - Math.PI / 2;
    const labelRadius = maxRadius + 28;
    const x = cx + Math.cos(angle) * labelRadius;
    const y = cy + Math.sin(angle) * labelRadius;

    ctx.fillStyle = meta.color;
    const label = t(meta.labelKey);
    // Split long labels
    const words = label.split(' ');
    if (words.length > 1) {
      ctx.fillText(words.slice(0, Math.ceil(words.length / 2)).join(' '), x, y - 7);
      ctx.fillText(words.slice(Math.ceil(words.length / 2)).join(' '), x, y + 7);
    } else {
      ctx.fillText(label, x, y);
    }
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'hsla(220, 20%, 50%, 0.5)';
  ctx.fill();
}
