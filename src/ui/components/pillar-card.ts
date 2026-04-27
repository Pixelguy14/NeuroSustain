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
          <div class="pillar-card__icon icon" style="background: ${meta.color}22; color: ${meta.color}">
            ${meta.icon}
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
            <span class="pillar-card__fatigue-icon icon">bedtime</span>
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
        <span class="exercise-item__glyph icon">${ex.iconGlyph}</span>
        <span class="exercise-item__name">${t(ex.nameKey)}</span>
        ${isDue && !isLocked ? '<span class="exercise-item__due-badge icon" style="margin-left: auto; margin-right: 8px; font-size: 16px; color: var(--color-warning);">history</span>' : ''}
        ${isLocked ? '<span class="exercise-item__lock icon">lock</span>' : '<span class="exercise-item__arrow icon">chevron_right</span>'}
        <div class="exercise-item__tooltip">${isLocked ? t('train.locked') : t(ex.descriptionKey)}</div>
      </div>
    `;
  }
}

if (!customElements.get('pillar-card')) {
  customElements.define('pillar-card', PillarCard);
}
