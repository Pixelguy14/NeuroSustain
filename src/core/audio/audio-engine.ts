// ============================================================
// NeuroSustain — Procedural Audio Engine (Web Audio API)
//
// Non-dopaminergic feedback system. All sounds are synthesized
// on-the-fly — zero asset files, zero network latency.
//
// Design principles:
//   - Correct: Clean 880Hz sine pulse (A5) — confirms, doesn't reward
//   - Error:   Dull 110Hz square thud (A2) — informs, doesn't punish
//   - Transition: 220→880Hz sweep for context switch alerts
//   - Ambience: White noise + LFO bandpass simulating breathing
//
// AudioContext is lazily created on first user gesture to comply
// with browser autoplay policies. All methods silently no-op if
// the context hasn't been unlocked yet.
// ============================================================

// ============================================================

class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _enabled: boolean = true;
  private _ambienceGain: GainNode | null = null;
  private _ambienceLfo: OscillatorNode | null = null;
  private _ambienceSource: AudioBufferSourceNode | null = null;
  private _ambienceActive: boolean = false;
  private _preloadedBuffers: Map<string, AudioBuffer> = new Map();
  private _activeNodes: Set<AudioBufferSourceNode | OscillatorNode> = new Set();

  // ── Lazy Initialization ──────────────────────────────────

  /**
   * Ensure the AudioContext exists. Must be called from a user
   * gesture handler (click, keydown, touchstart) the first time.
   * Subsequent calls are no-ops.
   */
  private _ensure_context(): AudioContext | null {
    if (this._ctx) return this._ctx;

    try {
      this._ctx = new AudioContext();
      // Resume if suspended (Safari requires this)
      if (this._ctx.state === 'suspended') {
        this._ctx.resume();
      }
      return this._ctx;
    } catch (err) {
      console.warn('[AudioEngine] Web Audio API unavailable:', err);
      return null;
    }
  }

  // ── Offline Buffer Pre-rendering (Zero Allocation) ───────

  private async _prerender_tone(
    name: string,
    frequency: number | number[],
    waveform: OscillatorType,
    duration: number,
    gain: number | number[],
    sweep?: number
  ): Promise<void> {
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);
    
    const freqs = Array.isArray(frequency) ? frequency : [frequency];
    const gains = Array.isArray(gain) ? gain : [gain];

    freqs.forEach((f, i) => {
      const g = gains[i] ?? gains[0]!;
      const osc = offlineCtx.createOscillator();
      const gainNode = offlineCtx.createGain();

      osc.type = waveform;
      osc.frequency.setValueAtTime(f, 0);

      if (sweep !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(sweep, duration);
      }

      gainNode.gain.setValueAtTime(g, 0);
      gainNode.gain.exponentialRampToValueAtTime(0.001, duration);

      osc.connect(gainNode);
      gainNode.connect(offlineCtx.destination);

      osc.start(0);
      osc.stop(duration);
    });

    const buffer = await offlineCtx.startRendering();
    this._preloadedBuffers.set(name, buffer);
  }

  private async _prerender_tick(name: string, isGo: boolean): Promise<void> {
    const duration = 0.5;
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);
    
    const frequency = isGo ? 880 : 440;
    const osc = offlineCtx.createOscillator();
    const gainNode = offlineCtx.createGain();
    const filter = offlineCtx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, 0);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency * 2, 0);
    filter.frequency.exponentialRampToValueAtTime(100, 0.4);

    gainNode.gain.setValueAtTime(isGo ? 0.25 : 0.15, 0);
    gainNode.gain.exponentialRampToValueAtTime(0.001, 0.4);

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    osc.start(0);
    osc.stop(duration);

    const buffer = await offlineCtx.startRendering();
    this._preloadedBuffers.set(name, buffer);
  }

  private _play_buffer(name: string): void {
    if (!this._enabled) return;
    const ctx = this._ensure_context();
    if (!ctx) return;
    const buffer = this._preloadedBuffers.get(name);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  }

  // ── Public Sound Triggers ────────────────────────────────

  /** Correct answer feedback */
  play_correct(): void {
    this._play_buffer('correct');
  }

  /** Error feedback */
  play_error(): void {
    this._play_buffer('error');
  }

  /** Context transition alert */
  play_transition(): void {
    this._play_buffer('transition');
  }

  /** UI tick (countdown) */
  play_tick(isGo: boolean = false): void {
    this._play_buffer(isGo ? 'tick_go' : 'tick_wait');
  }

  /** Tactile UI click */
  play_ui_click(): void {
    this._play_buffer('ui_click');
  }

  /** Dynamic simple tone */
  play_tone(frequency: number, durationMs: number = 300): void {
    // Kept dynamic for arbitrary frequencies
    this._play_tone(frequency, 'sine', durationMs / 1000, 0.2);
  }

  /**
   * Play a single tone with configurable envelope (Dynamic Allocation)
   */
  private _play_tone(
    frequency: number,
    waveform: OscillatorType,
    duration: number,
    gain: number,
    sweep?: number
  ): void {
    if (!this._enabled) return;
    const ctx = this._ensure_context();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    if (sweep !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(sweep, ctx.currentTime + duration);
    }

    gainNode.gain.setValueAtTime(gain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    this._activeNodes.add(oscillator);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration + 0.01);

    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
      this._activeNodes.delete(oscillator);
    };
  }

  /**
   * Play a rich, additive synthesis tone mimicking a jazz piano/electric piano.
   * Uses multiple oscillators for harmonics and a per-note envelope.
   */
  play_musical_tone(frequency: number, durationMs: number): void {
    if (!this._enabled) return;
    const ctx = this._ensure_context();
    if (!ctx) return;

    const duration = durationMs / 1000;
    const now = ctx.currentTime;

    // Create a series of harmonics for "warmth"
    // Fundamental + 2nd, 3rd, 4th harmonics
    const harmonics = [
      { f: 1, g: 0.5, type: 'sine' as OscillatorType },
      { f: 2, g: 0.2, type: 'sine' as OscillatorType },
      { f: 3, g: 0.1, type: 'triangle' as OscillatorType },
      { f: 4, g: 0.05, type: 'sine' as OscillatorType }
    ];

    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    // Piano Envelope: Fast attack, exponential decay
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.4, now + 0.005);
    masterGain.gain.exponentialRampToValueAtTime(0.15, now + 0.15);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    harmonics.forEach(h => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      
      osc.type = h.type;
      osc.frequency.setValueAtTime(frequency * h.f, now);
      
      g.gain.setValueAtTime(h.g, now);
      
      osc.connect(g);
      g.connect(masterGain);
      
      this._activeNodes.add(osc);
      osc.start(now);
      osc.stop(now + duration + 0.1);

      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
        this._activeNodes.delete(osc);
      };
    });

    // Cleanup master gain
    setTimeout(() => {
      masterGain.disconnect();
    }, durationMs + 200);
  }

  /**
   * N-Back auditory stimuli.
   * Maps 8 indices to a C Major scale for a pleasant, non-mechanical piano sound.
   */
  play_nback_letter(index: number): void {
    if (!this._enabled) return;
    
    const C_MAJOR_SCALE = [
      261.63, // C4
      293.66, // D4
      329.63, // E4
      349.23, // F4
      392.00, // G4
      440.00, // A4
      493.88, // B4
      523.25  // C5
    ];
    
    const frequency = C_MAJOR_SCALE[index % C_MAJOR_SCALE.length]!;
    this.play_musical_tone(frequency, 250); // Slightly longer for clarity
  }

  // ── Focus Ambience ───────────────────────────────────────

  /**
   * Start a subtle background ambience:
   * White noise → BandPass (200-800Hz) → LFO-modulated cutoff at 0.15Hz
   *
   * Gain is set to 0.03 — barely audible, subliminal focus aid
   * simulating a deep breathing rhythm.
   */
  start_ambience(): void {
    if (!this._enabled || this._ambienceActive) return;
    const ctx = this._ensure_context();
    if (!ctx) return;

    // Generate 2 seconds of white noise
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Noise source (looping)
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // BandPass filter centered at 500Hz
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(500, ctx.currentTime);
    bandpass.Q.setValueAtTime(1.5, ctx.currentTime);

    // LFO modulating the filter cutoff (breathing rhythm)
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.15, ctx.currentTime); // ~4s cycle ≈ breathing
    lfoGain.gain.setValueAtTime(300, ctx.currentTime);    // Modulates ±300Hz

    lfo.connect(lfoGain);
    lfoGain.connect(bandpass.frequency);

    // Master gain (barely audible)
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.03, ctx.currentTime);

    // Signal chain: source → bandpass → gain → destination
    source.connect(bandpass);
    bandpass.connect(masterGain);
    masterGain.connect(ctx.destination);

    source.start();
    lfo.start();

    this._ambienceSource = source;
    this._ambienceLfo = lfo;
    this._ambienceGain = masterGain;
    this._ambienceActive = true;
  }

  /**
   * Fade out and stop the ambience over 1 second.
   */
  stop_ambience(): void {
    if (!this._ambienceActive || !this._ctx || !this._ambienceGain) return;

    const ctx = this._ctx;
    this._ambienceGain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + 1.0
    );

    // Clean up after fade
    setTimeout(() => {
      try {
        this._ambienceSource?.stop();
        this._ambienceLfo?.stop();
      } catch {
        // Already stopped
      }
      this._ambienceSource?.disconnect();
      this._ambienceLfo?.disconnect();
      this._ambienceGain?.disconnect();
      this._ambienceSource = null;
      this._ambienceLfo = null;
      this._ambienceGain = null;
      this._ambienceActive = false;
    }, 1100);
  }

  /** Fade ambience volume down for menus/results */
  duckAmbience(): void {
    if (this._ambienceGain && this._ctx) {
      this._ambienceGain.gain.setTargetAtTime(0.005, this._ctx.currentTime, 0.5);
    }
  }

  /** Restore ambience volume for active focus */
  focusAmbience(): void {
    if (this._ambienceGain && this._ctx) {
      this._ambienceGain.gain.setTargetAtTime(0.03, this._ctx.currentTime, 1.5);
    }
  }

  // ── Control ──────────────────────────────────────────────

  /** Enable or disable all audio output */
  set_enabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this.stop_ambience();
    }
  }

  /** Check if audio is currently enabled */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Unlock the AudioContext and pre-render standard buffers */
  async unlock(): Promise<void> {
    const ctx = this._ensure_context();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    // Pre-render core synthesis sounds on first gesture to ensure zero-allocation during gameplay
    if (this._preloadedBuffers.size === 0) {
      await Promise.all([
        this._prerender_tone('correct', [523.25, 783.99], 'sine', 0.5, [0.1, 0.08]),
        this._prerender_tone('error', 150, 'sine', 0.1, 0.15),
        this._prerender_tone('transition', 220, 'sine', 0.3, 0.12, 880),
        this._prerender_tone('ui_click', 2400, 'sine', 0.005, 0.05),
        this._prerender_tick('tick_wait', false),
        this._prerender_tick('tick_go', true)
      ]);
    }
  }

  /** Force stop all active oscillators and buffer sources */
  stop_all_session_audio(): void {
    this._activeNodes.forEach(node => {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // Already stopped or disconnected
      }
    });
    this._activeNodes.clear();
  }
}

/** Singleton audio engine instance */
export const audioEngine = new AudioEngine();
