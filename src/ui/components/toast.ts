// ============================================================
// NeuroSustain — Toast Notification System
// Lightweight, transient UI feedback for background tasks.
// ============================================================

export type ToastType = 'info' | 'success' | 'error';

class ToastManager {
  private _container: HTMLDivElement | null = null;

  private _ensure_container() {
    if (this._container) return;
    this._container = document.createElement('div');
    this._container.id = 'toast-container';
    this._container.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
    `;
    document.body.appendChild(this._container);
  }

  show(message: string, type: ToastType = 'info', duration = 3000) {
    this._ensure_container();

    const toast = document.createElement('div');
    const colors = {
      info: 'hsl(225, 25%, 15%)',
      success: 'hsl(145, 60%, 25%)',
      error: 'hsl(0, 60%, 25%)'
    };
    const borders = {
      info: 'hsl(220, 20%, 35%)',
      success: 'hsl(145, 65%, 50%)',
      error: 'hsl(0, 70%, 55%)'
    };

    toast.style.cssText = `
      padding: 12px 20px;
      background: ${colors[type]};
      border: 1px solid ${borders[type]};
      color: white;
      border-radius: 8px;
      font-family: Inter, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      pointer-events: auto;
    `;
    toast.textContent = message;

    this._container!.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Animate out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
    
    return toast;
  }
}

export const toast = new ToastManager();
