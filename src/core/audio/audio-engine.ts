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

class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _enabled: boolean = true;
  private _ambienceGain: GainNode | null = null;
  private _ambienceLfo: OscillatorNode | null = null;
  private _ambienceSource: AudioBufferSourceNode | null = null;
  private _ambienceActive: boolean = false;

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

  // ── Core Synthesizer ─────────────────────────────────────

  /**
   * Play a single tone with configurable envelope.
   *
   * @param frequency  - Hz
   * @param waveform   - OscillatorType
   * @param duration   - Seconds
   * @param gain       - Volume (0-1)
   * @param sweep      - Optional target frequency for a sweep effect
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
      oscillator.frequency.exponentialRampToValueAtTime(
        sweep,
        ctx.currentTime + duration
      );
    }

    // Envelope: instant attack, exponential decay
    gainNode.gain.setValueAtTime(gain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + duration
    );

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration + 0.01);

    // Cleanup after playback
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
    };
  }

  // ── Public Sound Triggers ────────────────────────────────

  /**
   * Correct answer feedback.
   * Clean 880Hz (A5) sine pulse with fast 0.1s decay.
   */
  play_correct(): void {
    this._play_tone(880, 'sine', 0.1, 0.15);
  }

  /**
   * Error feedback.
   * Dull 110Hz (A2) square wave at low gain — thud, not screech.
   */
  play_error(): void {
    this._play_tone(110, 'square', 0.15, 0.08);
  }

  /**
   * Context transition alert (Neural Storm mode, subtrahend change).
   * 220→880Hz ascending sweep over 0.3s.
   */
  play_transition(): void {
    this._play_tone(220, 'sine', 0.3, 0.12, 880);
  }

  /**
   * UI tick (countdown, timer).
   * Sharp 1200Hz triangle, 20ms — minimal and precise.
   */
  play_tick(): void {
    this._play_tone(1200, 'triangle', 0.02, 0.1);
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

  /** Unlock the AudioContext (call from a user gesture handler) */
  unlock(): void {
    this._ensure_context();
  }
}

/** Singleton audio engine instance */
export const audioEngine = new AudioEngine();
