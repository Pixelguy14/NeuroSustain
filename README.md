# NeuroSustain

> Gamificar el ejercicio mental y evitar la degradación por scrolling y el uso excesivo de las IA.

**Live Application:** [https://pixelguy14.github.io/NeuroSustain/](https://pixelguy14.github.io/NeuroSustain/)

NeuroSustain is a privacy-sovereign Progressive Web App (PWA) designed to deliver evidence-based cognitive training. It serves as a modern alternative to traditional "brain training" applications, focusing on millisecond-precision measurement, radical transparency, and the mitigation of cognitive fatigue induced by digital fragmentation.

## Core Philosophy

1.  **Anti-Scrolling:** Exercises are specifically designed to rebuild sustained attention and context-switching resilience—the very faculties degraded by short-form video consumption.
2.  **Anti-AI Dependency:** Novel exercises (like the Semantic Linker) force the prefrontal cortex to actively map logical relationships, combating the passive consumption habits formed by relying on LLMs for synthesis.
3.  **Radical Transparency:** No "black box" algorithms. The system uses established neuroscience metrics (Coefficient of Variation, Switch Costs) and exposes the underlying mechanisms to the user through actionable, DOI-cited insights.
4.  **Local-First Privacy:** Zero centralized databases. All cognitive data, performance histories, and algorithmic states live exclusively on the user's device via IndexedDB.

## The Five Cognitive Pillars

NeuroSustain categorizes exercises into five distinct neurological domains:

1.  **Working Memory:** Hold and manipulate information. (*N-Back Dual*, *Serial Subtraction*, *Piano Player*)
2.  **Cognitive Flexibility:** Rapidly adapt to changing rules. (*Set Switching*, *Word Scramble*, *Change Maker*)
3.  **Inhibitory Control:** Suppress impulsive responses. (*Stroop Task*, *High Number*, *Fallacy Detector*)
4.  **Sustained Attention:** Maintain focus without distraction. (*Tower of Hanoi*, *Pattern Breaker*, *3D Box Counting*)
5.  **Processing Speed:** Raw baseline neural transmission speed. (*Reaction Time*, *Symbol Search*, *Inspection Time*)

## Technical Architecture

*   **Frontend:** Vanilla TypeScript + Canvas 2D + Web Components. Designed for zero Virtual DOM reconciliation overhead to guarantee sub-millisecond measurement accuracy.
*   **Storage:** Dexie.js (IndexedDB wrapper) for robust offline persistence.
*   **Adaptive Difficulty:** Adaptive Staircase Procedure (3-Up, 1-Down) for intra-session titration + Glicko-2 "Phantom Opponent" for baseline evolution.
*   **Spaced Repetition:** Free Spaced Repetition Scheduler (FSRS) running in a dedicated Web Worker to prevent UI blocking.
*   **Infrastructure:** Vite + Workbox (PWA capabilities).

## Documentation

For deep dives into the system's design and logic, review the following documents:

*   [`ARCHITECTURE.md`](ARCHITECTURE.md): System design, layer decoupling, and tech stack rationale.
*   [`METHODOLOGY.md`](METHODOLOGY.md): Scientific validity, CV calculations, Glicko-2, and FSRS implementation details.
*   [`API.md`](API.md): Internal module boundaries and data flow contracts.

## Development Setup

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Type check
npm run build
```

## i18n & Localization

The application is built with native support for English and Spanish. 
*Note on Cognitive Measurement:* The language setting inherently alters the semantic load of certain text-based exercises (e.g., Word Scramble). Spanish, having a longer average word length and different letter frequency distributions, presents a measurably different cognitive variable than English. The procedural generation engines are aware of the active locale to maintain calibrated difficulty curves.
