// ============================================================
// NeuroSustain — Pillar Card Component
// Bento-grid cell representing a cognitive pillar
// ============================================================

import { t } from '@shared/i18n.ts';
import type { CognitivePillar, ExerciseInfo } from '@shared/types.ts';
import { PILLAR_META } from '@shared/constants.ts';

export class PillarCard extends HTMLElement {
  private _pillar!: CognitivePillar;
  private _exercises: ExerciseInfo[] = [];
  private _rating: number = 1500;
  private _rd: number = 350;
  private _isFatigued: boolean = false;
  private _dueExercises: string[] = [];

  set data(payload: { 
    pillar: CognitivePillar; 
    exercises: ExerciseInfo[]; 
    rating?: number; 
    rd?: number;
    isFatigued?: boolean;
    dueExercises?: string[];
  }) {
    this._pillar = payload.pillar;
    this._exercises = payload.exercises;
    this._rating = payload.rating ?? 1500;
    this._rd = payload.rd ?? 350;
    this._isFatigued = payload.isFatigued ?? false;
    this._dueExercises = payload.dueExercises ?? [];
    this.render();
  }

  private render() {
    const meta = PILLAR_META[this._pillar];
    
    this.innerHTML = `
      <div class="pillar-card glass-panel ${this._isFatigued ? 'pillar-card--fatigued' : ''}">
        <header class="pillar-card__header">
          <div class="pillar-card__icon" style="background: ${meta.color}22; color: ${meta.color}">
            ${this._get_pillar_icon()}
          </div>
          <div class="pillar-card__title-group">
            <h3 class="pillar-card__title">${t(meta.labelKey)}</h3>
            <div class="pillar-card__rating" title="${t('glicko.tooltip', { defaultValue: 'Glicko-2 Skill Rating. RD indicates uncertainty (lower is more accurate).' })}">
              <span class="pillar-card__rating-val">${Math.round(this._rating)}</span>
              <span class="pillar-card__rating-label">RD ${Math.round(this._rd)}</span>
            </div>
          </div>
        </header>

        <div class="pillar-card__exercises">
          ${this._exercises.map(ex => this._render_exercise_item(ex)).join('')}
        </div>

        ${this._isFatigued ? `
          <div class="pillar-card__fatigue-overlay">
            <span class="pillar-card__fatigue-icon">💤</span>
            <span class="pillar-card__fatigue-text">Neural load high</span>
          </div>
        ` : ''}
      </div>
    `;

    // Wire up events
    this.querySelectorAll('.exercise-item:not(.exercise-item--locked)').forEach(item => {
      item.addEventListener('click', (_e) => {
        const type = (item as HTMLElement).dataset['type'];
        if (type) {
          this.dispatchEvent(new CustomEvent('select-exercise', { 
            detail: { type },
            bubbles: true,
            composed: true
          }));
        }
      });
    });
  }

  private _render_exercise_item(ex: ExerciseInfo) {
    const isLocked = !ex.available; // Could also check RD threshold here
    const isDue = this._dueExercises.includes(ex.type);
    
    return `
      <div class="exercise-item ${isLocked ? 'exercise-item--locked' : ''} ${isDue ? 'exercise-item--due' : ''}" data-type="${ex.type}">
        <span class="exercise-item__glyph">${ex.iconGlyph}</span>
        <span class="exercise-item__name">${t(ex.nameKey)}</span>
        ${isDue && !isLocked ? '<span class="exercise-item__due-badge" style="margin-left: auto; margin-right: 8px; font-size: 10px; color: var(--color-warning); border: 1px solid var(--color-warning); padding: 2px 6px; border-radius: 4px; font-weight: 600;">🔥 Due</span>' : ''}
        ${isLocked ? '<span class="exercise-item__lock">🔒</span>' : '<span class="exercise-item__arrow">→</span>'}
      </div>
    `;
  }

  private _get_pillar_icon(): string {
    switch(this._pillar) {
      case 'ProcessingSpeed': return '⚡';
      case 'InhibitoryControl': return '🎨';
      case 'WorkingMemory': return '🧠';
      case 'SustainedAttention': return '🔍';
      case 'CognitiveFlexibility': return '🔀';
      default: return '●';
    }
  }
}

if (!customElements.get('pillar-card')) {
  customElements.define('pillar-card', PillarCard);
}
