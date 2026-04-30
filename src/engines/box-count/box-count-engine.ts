// ============================================================
// NeuroSustain — 3D Box Counting Engine
// Sustained Attention + Spatial Visualization
//
// Generates an isometric stack of cubes. The user must
// mentally rotate the shape to deduce hidden cubes and
// calculate the total volume.
//
// Zero-Allocation: Single InstancedMesh updated per trial.
// Lazy-Loaded: Three.js only imports when this starts.
// ============================================================

import { BaseEngine } from '../base-engine.ts';
import type { ExerciseType, CognitivePillar, EngineCallbacks } from '@shared/types.ts';
import { precise_now } from '@shared/utils.ts';
import { audioEngine } from '@core/audio/audio-engine.ts';

type Phase = 'countdown' | 'playing' | 'feedback';

// We dynamically import Three.js types to avoid bringing them into the global scope
// but we declare any used types as `any` or generic if needed, or we just rely on inference.
let THREE: any = null;

const NUMPAD_LAYOUT = [
  { label: '1', value: '1', row: 0, col: 0 },
  { label: '2', value: '2', row: 0, col: 1 },
  { label: '3', value: '3', row: 0, col: 2 },
  { label: '4', value: '4', row: 1, col: 0 },
  { label: '5', value: '5', row: 1, col: 1 },
  { label: '6', value: '6', row: 1, col: 2 },
  { label: '7', value: '7', row: 2, col: 0 },
  { label: '8', value: '8', row: 2, col: 1 },
  { label: '9', value: '9', row: 2, col: 2 },
  { label: '⌫', value: 'Backspace', row: 3, col: 0 },
  { label: '0', value: '0', row: 3, col: 1 },
  { label: '↵', value: 'Enter', row: 3, col: 2 },
];

export class BoxCountEngine extends BaseEngine {
  readonly exerciseType: ExerciseType = 'BlockCount3D';
  readonly primaryPillar: CognitivePillar = 'SustainedAttention';
  readonly totalTrials: number = 10;
  protected validReactionTimeMax: number = 30000;

  private _phase: Phase = 'countdown';
  private _phaseStart: number = 0;

  private _timeLimitMs: number = 20000;
  private _userInput: string = '';
  private _correctCount: number = 0;
  private _isCorrect: boolean = false;

  // Three.js State
  private _scene: any = null;
  private _camera: any = null;
  private _renderer: any = null;
  private _instancedMesh: any = null;
  private _gridGroup: any = null;
  private _maxInstances: number = 200;
  private _rotationSpeed: number = 0.002;
  private _firstKeystrokeMs: number | null = null;
  private _isDragging: boolean = false;
  private _lastMouseX: number = 0;
  private _lastMouseY: number = 0;

  // Numpad geometry
  private _numpadX: number = 0;
  private _numpadY: number = 0;
  private _btnW: number = 0;
  private _btnH: number = 0;
  private _numpadGap: number = 8;

  // We mount the WebGL canvas over the 2D canvas
  private _glCanvas: HTMLCanvasElement;
  private _isThreeLoaded: boolean = false;
  private _loadError: string | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    super(canvas, callbacks);
    
    // Create an overlay canvas for WebGL
    this._glCanvas = document.createElement('canvas');
    this._glCanvas.style.position = 'absolute';
    this._glCanvas.style.top = '0';
    this._glCanvas.style.left = '0';
    this._glCanvas.style.width = '100%';
    this._glCanvas.style.height = '100%';
    this._glCanvas.style.pointerEvents = 'none'; // Let clicks pass to the 2D canvas if needed
    this._glCanvas.style.zIndex = '1';
    
    // Explicitly position the 2D canvas on top
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.zIndex = '2';
    
    // Ensure the parent wrapper has relative positioning
    if (this.canvas.parentElement) {
      this.canvas.parentElement.appendChild(this._glCanvas);
    }
  }

  protected on_start(): void {
    this._phaseStart = precise_now();
    this.start_countdown(() => this._next_trial());
    this._init_three_with_retry();
  }

  private async _init_three_with_retry(attempts: number = 0): Promise<void> {
    if (attempts > 50) {
      this._loadError = '3D Graphics Initialization Failed';
      this.record_trial({
        exerciseType: this.exerciseType,
        pillar: this.primaryPillar,
        timestamp: Date.now(),
        difficulty: this._currentDifficulty,
        isCorrect: false,
        reactionTimeMs: 0,
        metadata: { error: 'webgl_timeout' }
      });
      return;
    }

    try {
      if (!THREE) {
        THREE = await import('three');
      }
      if (!this._scene) this._setup_three_scene();
      this._isThreeLoaded = true;
      this._register_input_handlers();
    } catch (e) {
      setTimeout(() => this._init_three_with_retry(attempts + 1), 100);
    }
  }

  private _register_input_handlers(): void {
    try {
      this.canvas.onpointerdown = (e: MouseEvent) => {
        if (this._phase !== 'playing') return;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.width / rect.width;
        const scaleY = this.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
  
        for (const btn of NUMPAD_LAYOUT) {
          const bx = this._numpadX + btn.col * (this._btnW + this._numpadGap);
          const by = this._numpadY + btn.row * (this._btnH + this._numpadGap);
          if (x >= bx && x <= bx + this._btnW && y >= by && y <= by + this._btnH) {
            this._handle_input(btn.value);
            return;
          }
        }
      };

      // Register drag handler for 3D rotation
      this.canvas.onpointerdown = (e: PointerEvent) => {
        if (this._phase !== 'playing') return;
        const rect = this.canvas.getBoundingClientRect();
        const scaleY = this.height / rect.height;
        const y = (e.clientY - rect.top) * scaleY;
        
        // Ignore if clicking on the numpad area
        const padAreaH = Math.min(220, this.height * 0.4);
        const numpadY = this.height - padAreaH - 10;
        if (y >= numpadY) return;

        this._isDragging = true;
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
      };

      this.canvas.onpointermove = (e: PointerEvent) => {
        if (!this._isDragging || this._phase !== 'playing') return;
        const dx = e.clientX - this._lastMouseX;
        const dy = e.clientY - this._lastMouseY;
        this._gridGroup.rotation.y += dx * 0.005;
        this._gridGroup.rotation.x += dy * 0.005;
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
      };

      this.canvas.onpointerup = () => this._isDragging = false;
      this.canvas.onpointerleave = () => this._isDragging = false;

    } catch (e) {
      console.error('Failed to load Three.js:', e);
      this._loadError = 'Graphics Warning: WebGL Engine failed to initialize.';
    }
  }

  private _setup_three_scene(): void {
    const w = this.width;
    const h = this.height;

    this._scene = new THREE.Scene();
    
    // Isometric-style Orthographic Camera
    const aspect = w / h;
    const d = 10;
    this._camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    
    const isMobile = w < 600;
    const verticalShift = isMobile ? -6 : 2; // Look DOWN on mobile to move blocks UP
    this._camera.position.set(20, 20 + verticalShift, 20); 
    this._camera.lookAt(new THREE.Vector3(0, verticalShift, 0));

    this._renderer = new THREE.WebGLRenderer({ canvas: this._glCanvas, alpha: true, antialias: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this._scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    this._scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xaaccff, 0.4); // Blue fill
    dirLight2.position.set(-10, 5, -10);
    this._scene.add(dirLight2);

    this._gridGroup = new THREE.Group();
    this._scene.add(this._gridGroup);

    // Single Geometry and Material
    // Edge highlights help distinguish cubes in the isometric view
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    
    // Glassmorphic / clean aesthetic material
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x22d3ee, // Cyan-ish (hsl(180, 80%, 50%))
      roughness: 0.2,
      metalness: 0.1,
    });

    this._instancedMesh = new THREE.InstancedMesh(geometry, material, this._maxInstances);
    this._gridGroup.add(this._instancedMesh);
    
    // We can't easily instance edges with InstancedMesh without custom shaders, 
    // but the blocks are simple enough. For performance, we'll keep edges off the instanced mesh
    // and rely on lighting, OR we can accept the overhead of instancing edges if needed.
    // For now, good lighting + gaps will do.
  }

  protected on_update(_dt: number): void {
    const elapsed = precise_now() - this._phaseStart;

    if (this._isThreeLoaded && this._renderer) {
      const canvas3D = this._renderer.domElement;
      if (canvas3D.width !== this.width || canvas3D.height !== this.height) {
        this._renderer.setSize(this.width, this.height);
        const aspect = this.width / this.height;
        const d = 10;
        this._camera.left = -d * aspect;
        this._camera.right = d * aspect;
        this._camera.top = d;
        this._camera.bottom = -d;
        this._camera.updateProjectionMatrix();
      }

      if (this._phase === 'playing' && !this._isDragging) {
        // Slowly rotate the entire group to help depth perception when not interacting
        this._gridGroup.rotation.y += this._rotationSpeed;
      }
      this._renderer.render(this._scene, this._camera);
    }

    switch (this._phase) {
      case 'countdown': {
        // Handled by BaseEngine
        break;
      }

      case 'playing':
        if (elapsed >= this._timeLimitMs) {
          if (this._userInput.length > 0) {
            this._submit(parseInt(this._userInput, 10) === this._correctCount);
          } else {
            this._submit(false);
          }
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

    // We only clear the 2D canvas. The WebGL canvas is underneath/on top and transparent.
    ctx.clearRect(0, 0, w, h);

    // If we're not in playing or feedback, clear WebGL too
    if (this._phase === 'countdown' && this._renderer) {
      this._instancedMesh.count = 0; // Hide 3D
    }

    // Base background (drawn on 2D canvas so WebGL sits on it)
    if (this._phase === 'countdown' && !this._isThreeLoaded) {
      ctx.fillStyle = 'hsl(225, 45%, 6%)';
      ctx.fillRect(0, 0, w, h);
    }

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

    // Bring 2D canvas drawing to the front conceptually (by z-index config in constructor)
    // Wait, the constructor placed glCanvas with zIndex 1. 
    // We should ensure the 2D canvas is above if we want HUD to show over 3D.
    if (this.canvas.style.zIndex !== '2') {
       this.canvas.style.zIndex = '2';
       this.canvas.style.position = 'absolute';
       this.canvas.style.top = '0';
       this.canvas.style.left = '0';
       this.canvas.style.background = 'transparent'; // Let 3D show through
    }

    switch (this._phase) {
      case 'countdown':
        if (!this._isThreeLoaded && !this._loadError) {
          ctx.font = '400 14px Inter, sans-serif';
          ctx.fillStyle = 'hsla(220, 15%, 55%, 0.8)';
          ctx.fillText('Loading 3D Engine...', cx, cy + 60);
        } else if (this._loadError) {
          ctx.font = '500 14px Inter, sans-serif';
          ctx.fillStyle = 'hsl(0, 70%, 60%)';
          ctx.fillText(this._loadError, cx, cy + 60);
          ctx.font = '400 12px Inter, sans-serif';
          ctx.fillStyle = 'hsla(0, 0%, 100%, 0.5)';
          ctx.fillText('Tap Abort to exit.', cx, cy + 85);
        }
        break;

      case 'playing':
        this._render_ui(ctx, cx, w, h);
        break;

      case 'feedback':
        this._render_ui(ctx, cx, w, h);
        this._render_feedback(ctx, cx, cy);
        break;
    }
  }

  private _render_ui(ctx: CanvasRenderingContext2D, cx: number, w: number, h: number): void {
    const elapsed = precise_now() - this._phaseStart;

    // Time bar
    if (this._phase === 'playing') {
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

    // Numpad Geometry calculation (responsive)
    const padAreaW = Math.min(260, w * 0.9);
    const padAreaH = Math.min(220, h * 0.4);
    this._btnW = (padAreaW - this._numpadGap * 2) / 3;
    this._btnH = (padAreaH - this._numpadGap * 3) / 4;
    this._numpadX = cx - padAreaW / 2;
    this._numpadY = h - padAreaH - 10;

    // Input area
    const inputY = this._numpadY - 45;
    
    ctx.font = '400 13px Inter, sans-serif';
    ctx.fillStyle = 'hsla(220, 15%, 60%, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('How many blocks total?', cx, inputY - 30);

    const inputW = 140;
    const inputH = 44;
    ctx.beginPath();
    ctx.roundRect(cx - inputW / 2, inputY - inputH / 2, inputW, inputH, 8);
    ctx.fillStyle = 'hsla(225, 30%, 12%, 0.8)';
    ctx.fill();
    ctx.strokeStyle = this._userInput.length > 0
      ? 'hsla(175, 60%, 45%, 0.8)'
      : 'hsla(220, 20%, 30%, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.fillStyle = 'hsl(220, 20%, 90%)';
    ctx.fillText(this._userInput || '…', cx, inputY);

    // Render Numpad
    for (const btn of NUMPAD_LAYOUT) {
      const bx = this._numpadX + btn.col * (this._btnW + this._numpadGap);
      const by = this._numpadY + btn.row * (this._btnH + this._numpadGap);

      ctx.beginPath();
      ctx.roundRect(bx, by, this._btnW, this._btnH, 8);
      ctx.fillStyle = 'hsla(225, 30%, 15%, 0.8)';
      ctx.fill();
      ctx.strokeStyle = 'hsla(220, 20%, 35%, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = `600 ${Math.min(this._btnH * 0.4, 20)}px Inter, sans-serif`;
      ctx.fillStyle = 'hsl(220, 15%, 85%)';
      
      // Highlight special keys
      if (btn.value === 'Enter') {
        ctx.fillStyle = 'hsl(175, 70%, 55%)';
      } else if (btn.value === 'Backspace') {
        ctx.fillStyle = 'hsl(0, 65%, 65%)';
      }

      ctx.fillText(btn.label, bx + this._btnW / 2, by + this._btnH / 2);
    }
  }

  private _render_feedback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.fillStyle = 'hsla(225, 45%, 6%, 0.8)';
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
      ctx.font = '500 20px Inter, sans-serif';
      ctx.fillStyle = 'hsla(220, 15%, 60%, 0.9)';
      ctx.fillText(`Actual count: ${this._correctCount}`, cx, cy + 30);
    }
  }

  protected on_key_down(code: string, _timestamp: number): void {
    if (this._phase !== 'playing') return;

    if (code === 'Enter' || code === 'NumpadEnter') {
      this._handle_input('Enter');
      return;
    }

    if (code === 'Backspace') {
      this._handle_input('Backspace');
      return;
    }

    const numMatch = code.match(/^(?:Digit|Numpad)(\d)$/);
    if (numMatch) {
      this._handle_input(numMatch[1]!);
    }
  }

  private _handle_input(val: string): void {
    if (this._phase !== 'playing') return;

    audioEngine.play_tick();

    if (val === 'Enter') {
      if (this._userInput.length > 0) {
        this._submit(parseInt(this._userInput, 10) === this._correctCount);
      }
      return;
    }

    if (val === 'Backspace') {
      this._userInput = this._userInput.slice(0, -1);
      return;
    }

    if (this._userInput.length < 3) {
      this._userInput += val;
      if (!this._firstKeystrokeMs) this._firstKeystrokeMs = precise_now() - this._phaseStart;
    }
  }

  protected on_cleanup(): void {
    if (this._instancedMesh) {
      this._instancedMesh.geometry.dispose();
      if (Array.isArray(this._instancedMesh.material)) {
        this._instancedMesh.material.forEach((m: any) => m.dispose());
      } else {
        this._instancedMesh.material.dispose();
      }
    }
    if (this._glCanvas && this._glCanvas.parentElement) {
      this._glCanvas.parentElement.removeChild(this._glCanvas);
    }
    if (this._renderer) {
      this._renderer.dispose();
    }
  }

  // ── Logic ───────────────────────────────────────────────

  private _next_trial(): void {
    if (!this._isThreeLoaded) {
      // If Three.js isn't ready yet, defer for 100ms
      setTimeout(() => this._next_trial(), 100);
      return;
    }

    const diff = this._currentDifficulty;

    // Grid bounds
    let gridX = 3, gridY = 3, gridZ = 2; // Y is up
    if (diff > 3 && diff <= 7) { gridX = 4; gridY = 4; gridZ = 3; }
    else if (diff > 7) { gridX = 5; gridY = 5; gridZ = 4; }

    // Generate puzzle
    this._generate_puzzle(gridX, gridY, gridZ);

    // Time limit (increased for realistic cognitive load)
    if (diff <= 3) this._timeLimitMs = 45000;
    else if (diff <= 7) this._timeLimitMs = 35000;
    else this._timeLimitMs = 30000;

    // Slower rotation on easy levels
    this._rotationSpeed = diff <= 3 ? 0.001 : 0.003;
    
    // Reset group rotation to a nice starting angle
    this._gridGroup.rotation.set(0, Math.PI / 4, 0);

    this._userInput = '';
    this._firstKeystrokeMs = null;
    this._phase = 'playing';
    this._phaseStart = precise_now();
  }

  private _generate_puzzle(sx: number, sy: number, sz: number): void {
    // 3D array mapping [x][y][z] to boolean
    const grid: boolean[][][] = Array(sx).fill(false).map(() => 
      Array(sy).fill(false).map(() => Array(sz).fill(false))
    );

    // Gravity rule & Pyramid structure: favor blocks near center and lower heights
    const cx_grid = (sx - 1) / 2;
    const cz_grid = (sz - 1) / 2;
    const maxDist = Math.sqrt(cx_grid * cx_grid + cz_grid * cz_grid);

    let count = 0;
    for (let x = 0; x < sx; x++) {
      for (let z = 0; z < sz; z++) {
        // Distance from center
        const dist = Math.sqrt(Math.pow(x - cx_grid, 2) + Math.pow(z - cz_grid, 2));
        const normalizedDist = maxDist > 0 ? dist / maxDist : 0; // 0 at center, 1 at edges

        // Max height for this column (pyramid shape: taller in middle)
        const maxColHeight = Math.max(1, Math.floor(sy * (1 - normalizedDist * 0.8)));
        
        // Randomize height up to maxColHeight
        const colHeight = 1 + Math.floor(Math.random() * maxColHeight);
        
        // Additional chance to drop column entirely if on edges
        if (normalizedDist > 0.6 && Math.random() < 0.5) continue;

        for (let y = 0; y < colHeight; y++) {
           grid[x]![y]![z] = true;
           count++;
        }
      }
    }

    // Ensure at least some blocks
    if (count < 3) {
      grid[Math.floor(sx/2)]![0]![Math.floor(sz/2)] = true;
      count = 1;
    }

    this._correctCount = count;

    // Apply to InstancedMesh
    this._instancedMesh.count = count;
    let idx = 0;
    const dummy = new THREE.Object3D();
    const gap = 1.05; // slightly larger than 1 to show edges
    
    const offsetX = (sx * gap) / 2;
    const offsetY = (sy * gap) / 2;
    const offsetZ = (sz * gap) / 2;

    const color = new THREE.Color();

    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        for (let z = 0; z < sz; z++) {
          if (grid[x]![y]![z]) {
             dummy.position.set(
               x * gap - offsetX + gap/2,
               y * gap - offsetY + gap/2,
               z * gap - offsetZ + gap/2
             );
             dummy.updateMatrix();
             this._instancedMesh.setMatrixAt(idx, dummy.matrix);
             
             // Z-Height coloring (Darker blue at bottom, lighter cyan at top)
             const heightRatio = sy > 1 ? y / (sy - 1) : 0;
             const hue = 210 - (30 * heightRatio); // 210 -> 180
             const lightness = 0.3 + (0.3 * heightRatio); // 0.3 -> 0.6
             color.setHSL(hue / 360, 0.8, lightness);
             this._instancedMesh.setColorAt(idx, color);

             idx++;
          }
        }
      }
    }

    this._instancedMesh.instanceMatrix.needsUpdate = true;
    if (this._instancedMesh.instanceColor) {
      this._instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  private _submit(correct: boolean): void {
    this._isCorrect = correct;
    const reactionMs = precise_now() - this._phaseStart;
    const finalRT = this._firstKeystrokeMs || reactionMs;

    if (correct) {
      audioEngine.play_correct();
    } else {
      audioEngine.play_error();
    }

    this.record_trial({
      exerciseType: this.exerciseType,
      pillar: this.primaryPillar,
      timestamp: Date.now(),
      difficulty: this._currentDifficulty,
      isCorrect: correct,
      reactionTimeMs: finalRT,
      metadata: {
        trial: this.currentTrial + 1,
        correctCount: this._correctCount,
        userInput: parseInt(this._userInput, 10),
        timedOut: !correct && this._userInput === '',
      }
    });

    this._phase = 'feedback';
    this._phaseStart = precise_now();
  }
}
