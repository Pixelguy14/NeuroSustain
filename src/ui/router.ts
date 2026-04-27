// ============================================================
// NeuroSustain — Hash-based SPA Router
// Minimal router with no dependencies
// ============================================================

import type { Route } from '@shared/types.ts';

type RouteChangeCallback = (path: string) => void;

class Router {
  private _routes: Map<string, Route> = new Map();
  private _listeners: Set<RouteChangeCallback> = new Set();
  private _currentPath: string = '';

  constructor() {
    window.addEventListener('hashchange', () => this._handle_route());
    window.addEventListener('load', () => this._handle_route());
  }

  /** Register a route */
  register(route: Route): void {
    this._routes.set(route.path, route);
  }

  /** Navigate to a path */
  navigate(path: string): void {
    window.location.hash = path;
  }

  /** Get current path */
  get currentPath(): string {
    return this._currentPath;
  }

  /** Subscribe to route changes */
  on_change(fn: RouteChangeCallback): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Handle the current hash route */
  private async _handle_route(): Promise<void> {
    const hash = window.location.hash.slice(1) || '/dashboard';
    const route = this._routes.get(hash);

    if (!route) {
      this.navigate('/dashboard');
      return;
    }

    this._currentPath = hash;

    const container = document.getElementById('page-container');
    if (container) {
      container.innerHTML = '';
      const pageResult = route.render();
      
      if (pageResult instanceof Promise) {
        const page = await pageResult;
        container.innerHTML = ''; // Double check in case of race conditions
        container.appendChild(page);
      } else {
        container.appendChild(pageResult);
      }
    }

    document.title = `${route.title} — NeuroSustain`;
    this._listeners.forEach(fn => fn(hash));
  }
}

export const router = new Router();
