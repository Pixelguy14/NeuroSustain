// ============================================================
// NeuroSustain — Sparkline Component (Canvas 2D)
// Minimal trend visualization for intra-session metrics
// ============================================================

export function render_sparkline(
  canvas: HTMLCanvasElement,
  data: number[],
  options: {
    color?: string;
    lineWidth?: number;
    height?: number;
    isInverse?: boolean; // If true, lower values are better (e.g. RT)
  } = {}
): void {
  const {
    color = 'hsl(175, 70%, 50%)',
    lineWidth = 2,
    height = 40,
    isInverse = false
  } = options;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.parentElement?.clientWidth || 200;
  
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx || data.length < 2) return;

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const stepX = width / (data.length - 1);

  for (let i = 0; i < data.length; i++) {
    const val = data[i]!;
    const x = i * stepX;
    
    // Normalize to 0-1 and map to height
    // If isInverse, we want higher values to be physically lower on the canvas
    const normalized = (val - min) / range;
    const y = isInverse 
      ? 5 + normalized * (height - 10) // High RT = Low on screen
      : (height - 5) - normalized * (height - 10); // High Accuracy = High on screen

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();

  // Add a subtle gradient fill
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color.replace(')', ', 0.15)').replace('hsl(', 'hsla('));
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fill();
}
