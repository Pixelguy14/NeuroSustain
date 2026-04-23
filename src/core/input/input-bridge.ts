// ============================================================
// NeuroSustain — Input Bridge
//
// Normalizes keyboard and touch/click inputs into a unified
// InputEvent stream. This allows engines like Serial Subtraction
// to treat both modalities identically while recording which
// one was used (for separate FSRS baselines).
//
// Usage:
//   const bridge = new InputBridge(canvas, (x, y) => {
//     if (hit_test_button(x, y, '5')) return '5';
//     return null; // Click missed all buttons
//   });
//   bridge.on_input((event) => { /* handle */ });
//   bridge.destroy(); // On cleanup
// ============================================================

import { precise_now } from '@shared/utils.ts';

/** Unified input event emitted by the bridge */
export interface InputEvent {
  /** 'key' for physical keyboard, 'click' for pointer/touch */
  type: 'key' | 'click';
  /** The logical value: '0'-'9', 'Enter', 'Backspace', 'Space', etc. */
  value: string;
  /** High-resolution timestamp at the moment of capture */
  timestamp: number;
  /** Which modality produced this event */
  inputMode: 'keyboard' | 'touch';
}

export type InputCallback = (event: InputEvent) => void;

/**
 * Hit-test function provided by the engine.
 * Receives canvas-local coordinates and returns the logical
 * value of the button at that position, or null if nothing was hit.
 */
export type HitTestFn = (x: number, y: number) => string | null;

export class InputBridge {
  private _canvas: HTMLCanvasElement;
  private _hitTest: HitTestFn;
  private _callbacks: InputCallback[] = [];
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _pointerHandler: ((e: PointerEvent) => void) | null = null;
  private _destroyed: boolean = false;

  /** Allowed keyboard keys — everything else is ignored */
  private static readonly ALLOWED_KEYS = new Set([
    'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
    'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
    'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
    'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
    'Enter', 'NumpadEnter', 'Backspace', 'Space',
    // Piano Player pad keys
    'KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'KeyC',
  ]);

  constructor(canvas: HTMLCanvasElement, hitTest: HitTestFn) {
    this._canvas = canvas;
    this._hitTest = hitTest;
    this._attach();
  }

  /** Register a callback for unified input events */
  on_input(callback: InputCallback): void {
    this._callbacks.push(callback);
  }

  /** Remove all listeners and prevent further events */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
    }
    if (this._pointerHandler) {
      this._canvas.removeEventListener('pointerdown', this._pointerHandler);
    }
    this._callbacks = [];
  }

  // ── Private ──────────────────────────────────────────────

  private _attach(): void {
    // Keyboard path
    this._keyHandler = (e: KeyboardEvent) => {
      if (this._destroyed) return;
      if (!InputBridge.ALLOWED_KEYS.has(e.code)) return;
      e.preventDefault();

      const value = this._normalize_key(e.code);
      if (!value) return;

      this._emit({
        type: 'key',
        value,
        timestamp: precise_now(),
        inputMode: 'keyboard',
      });
    };
    window.addEventListener('keydown', this._keyHandler);

    // Pointer/touch path
    this._pointerHandler = (e: PointerEvent) => {
      if (this._destroyed) return;

      const rect = this._canvas.getBoundingClientRect();
      // Convert to canvas-logical coordinates (CSS pixels)
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const value = this._hitTest(x, y);
      if (!value) return;

      this._emit({
        type: 'click',
        value,
        timestamp: precise_now(),
        inputMode: 'touch',
      });
    };
    this._canvas.addEventListener('pointerdown', this._pointerHandler);
  }

  private _emit(event: InputEvent): void {
    for (const cb of this._callbacks) {
      cb(event);
    }
  }

  /** Map e.code to a clean logical value */
  private _normalize_key(code: string): string | null {
    // Digit row: 'Digit0' → '0'
    if (code.startsWith('Digit')) return code.charAt(5);
    // Numpad: 'Numpad0' → '0'
    if (code.startsWith('Numpad') && code !== 'NumpadEnter') return code.charAt(6);
    if (code === 'NumpadEnter' || code === 'Enter') return 'Enter';
    if (code === 'Backspace') return 'Backspace';
    if (code === 'Space') return 'Space';
    return null;
  }
}
