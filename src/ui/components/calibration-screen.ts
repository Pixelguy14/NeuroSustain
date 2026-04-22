// ============================================================
// NeuroSustain — Hardware Calibration Screen (Canvas 2D)
//
// Runs once on first launch. Presents a rapid-tap test:
//   "Tap the target 10 times as fast as you can"
//
// Measures inter-click intervals to characterize the hardware
// noise floor, then stores a HardwareProfile in IndexedDB.
// ============================================================

import {
  CALIBRATION_TAPS,
  measure_timer_resolution,
  measure_frame_period,
  analyze_calibration,
  grade_description,
} from '@core/calibration/hardware-calibration.ts';
import { save_hardware_profile } from '@shared/db.ts';
import type { HardwareProfile } from '@shared/types.ts';
import { t } from '@shared/i18n.ts';

type CalibrationPhase = 'intro' | 'tapping' | 'measuring' | 'result';

export function show_calibration_screen(onComplete: (profile: HardwareProfile) => void): void {
  // ── Build overlay ──────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'calibration-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 300;
    background: hsl(225, 45%, 6%);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: Inter, sans-serif;
  `;

  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  const SIZE = Math.min(window.innerWidth, window.innerHeight, 600);
  canvas.width  = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width  = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  canvas.style.cursor = 'crosshair';
  overlay.appendChild(canvas);
  document.body.appendChild(overlay);

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const TARGET_R = 44;

  // ── State ──────────────────────────────────────────────
  let phase: CalibrationPhase = 'intro';
  let tapCount = 0;
  const clickTimestamps: number[] = [];
  let profile: HardwareProfile | null = null;
  let animFrameId = 0;
  let pulseT = 0;

  // ── Render loop ────────────────────────────────────────
  function render(): void {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = 'hsl(225, 45%, 6%)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    pulseT += 0.03;

    if (phase === 'intro') {
      render_intro();
    } else if (phase === 'tapping') {
      render_tapping();
    } else if (phase === 'measuring') {
      render_measuring();
    } else if (phase === 'result' && profile) {
      render_result(profile);
    }

    animFrameId = requestAnimationFrame(render);
  }

  function render_intro(): void {
    ctx.textAlign = 'center';

    // Badge
    ctx.font = '600 13px Inter';
    ctx.fillStyle = 'hsla(175, 70%, 50%, 0.8)';
    ctx.fillText(t('calibration.intro.badge'), cx, cy - 120);

    ctx.font = 'bold 28px Inter';
    ctx.fillStyle = 'hsl(220, 20%, 92%)';
    ctx.fillText(t('calibration.intro.title'), cx, cy - 80);

    ctx.font = '400 15px Inter';
    ctx.fillStyle = 'hsl(220, 15%, 60%)';
    ctx.fillText(t('calibration.intro.instruction', { count: CALIBRATION_TAPS }), cx, cy - 48);
    // ctx.fillText('as fast as you can', cx, cy - 26); // Merged into instruction above

    // Pulsing target
    const pulse = 1 + Math.sin(pulseT) * 0.08;
    draw_target(cx, cy + 30, TARGET_R * pulse, 'hsl(175, 70%, 50%)', 0.6);

    // Start instruction
    ctx.font = '500 14px Inter';
    ctx.fillStyle = 'hsla(175, 70%, 50%, 0.7)';
    ctx.fillText(t('calibration.intro.begin'), cx, cy + 140);
  }

  function render_tapping(): void {
    ctx.textAlign = 'center';

    const progress = tapCount / CALIBRATION_TAPS;
    const pulse = 1 + Math.sin(pulseT * 2) * 0.05;

    // Progress arc
    ctx.beginPath();
    ctx.arc(cx, cy, TARGET_R + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = 'hsl(175, 70%, 50%)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Target
    draw_target(cx, cy, TARGET_R * pulse, 'hsl(175, 70%, 50%)', 1.0);

    // Counter
    ctx.font = 'bold 22px Inter';
    ctx.fillStyle = 'hsl(175, 70%, 50%)';
    ctx.fillText(t('calibration.tapping.counter', { current: tapCount, total: CALIBRATION_TAPS }), cx, cy + TARGET_R + 52);

    ctx.font = '400 13px Inter';
    ctx.fillStyle = 'hsl(220, 15%, 50%)';
    ctx.fillText(t('calibration.tapping.instruction'), cx, cy + TARGET_R + 74);
  }

  function render_measuring(): void {
    ctx.textAlign = 'center';

    // Spinner
    ctx.beginPath();
    ctx.arc(cx, cy, 28, pulseT, pulseT + Math.PI * 1.5);
    ctx.strokeStyle = 'hsl(175, 70%, 50%)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = '400 15px Inter';
    ctx.fillStyle = 'hsl(220, 15%, 55%)';
    ctx.fillText(t('calibration.measuring'), cx, cy + 60);
  }

  function render_result(p: HardwareProfile): void {
    const desc = grade_description(p.grade);
    ctx.textAlign = 'center';

    // Grade badge
    ctx.font = 'bold 42px Inter';
    ctx.fillStyle = desc.color;
    ctx.fillText(desc.label, cx, cy - 60);

    // Stats
    ctx.font = '500 14px Inter';
    ctx.fillStyle = 'hsl(220, 15%, 65%)';
    ctx.fillText(t('calibration.result.jitter', { ms: p.jitterSdMs.toFixed(1) }), cx, cy - 18);
    ctx.fillText(t('calibration.result.timer', { ms: p.timerResolutionMs.toFixed(2) }), cx, cy + 8);
    ctx.fillText(t('calibration.result.frame', { ms: p.frameErrorMs.toFixed(1) }), cx, cy + 32);

    // Warning (if any)
    if (desc.warning) {
      const lines = wrap_text(desc.warning, 38);
      ctx.font = '400 13px Inter';
      ctx.fillStyle = desc.color;
      lines.forEach((line, i) => {
        ctx.fillText(line, cx, cy + 70 + i * 20);
      });
    }

    // Continue button
    const btnY = cy + (desc.warning ? 70 + wrap_text(desc.warning, 38).length * 20 + 24 : 80);
    ctx.fillStyle = 'hsl(175, 70%, 50%)';
    ctx.beginPath();
    ctx.roundRect(cx - 80, btnY, 160, 40, 8);
    ctx.fill();
    ctx.font = '600 14px Inter';
    ctx.fillStyle = 'hsl(225, 45%, 6%)';
    ctx.fillText(t('calibration.result.continue'), cx, btnY + 25);

    // Store button Y for click detection
    canvas.dataset['btnY'] = String(btnY);
  }

  function draw_target(x: number, y: number, r: number, color: string, alpha: number): void {
    // Glow
    const glow = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2);
    glow.addColorStop(0, color.replace(')', ', 0.15)').replace('hsl(', 'hsla('));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.fill();

    // Circle
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color.replace(')', ', 0.15)').replace('hsl(', 'hsla(');
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Click handler ──────────────────────────────────────
  async function handle_click(e: MouseEvent): Promise<void> {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (SIZE / rect.width);
    const y = (e.clientY - rect.top) * (SIZE / rect.height);

    if (phase === 'intro') {
      // Check click is within target zone
      const dist = Math.hypot(x - cx, y - (cy + 30));
      if (dist <= TARGET_R * 1.5) {
        phase = 'tapping';
        clickTimestamps.push(performance.now());
        tapCount = 1;
      }
      return;
    }

    if (phase === 'tapping') {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= TARGET_R * 1.5) {
        clickTimestamps.push(performance.now());
        tapCount++;

        if (tapCount >= CALIBRATION_TAPS) {
          phase = 'measuring';
          canvas.removeEventListener('click', handle_click);
          await run_analysis();
        }
      }
      return;
    }

    if (phase === 'result' && profile) {
      const btnY = Number(canvas.dataset['btnY'] ?? 0);
      if (x >= cx - 80 && x <= cx + 80 && y >= btnY && y <= btnY + 40) {
        cancelAnimationFrame(animFrameId);
        overlay.remove();
        onComplete(profile);
      }
    }
  }

  async function run_analysis(): Promise<void> {
    // Compute inter-click intervals
    const intervals: number[] = [];
    for (let i = 1; i < clickTimestamps.length; i++) {
      intervals.push(clickTimestamps[i]! - clickTimestamps[i - 1]!);
    }

    const timerRes = measure_timer_resolution();
    const framePeriod = await measure_frame_period();
    const result = analyze_calibration(intervals, timerRes, framePeriod);

    const hw: HardwareProfile = { ...result, warningShown: result.grade === 'fair' || result.grade === 'poor' };
    await save_hardware_profile(hw);

    profile = hw;
    phase = 'result';
    canvas.addEventListener('click', handle_click);
  }

  canvas.addEventListener('click', handle_click);
  render();
}

/** Simple word-wrap utility for canvas text */
function wrap_text(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxCharsPerLine) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}
