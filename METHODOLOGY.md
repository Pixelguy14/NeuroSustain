# NeuroSustain: Methodology & Scientific Validity

NeuroSustain is built on the premise that cognitive training should be transparent, measurable, and grounded in established neuroscience. This document details the mathematical models and business logic that power the application's assessment engines, proving it is not a "black box" system.

## 1. Latency Analysis & Fatigue Detection

Traditional "brain training" games often reward speed alone. NeuroSustain analyzes the *consistency* of reaction times, which is a far more reliable indicator of cognitive health and focus.

### The Coefficient of Variation (CV)

The core metric for detecting cognitive fatigue and "brain rot" (e.g., from excessive scrolling or context switching) is the Coefficient of Variation of reaction times.

**Mathematical Definition:**
`CV = σ / μ`
Where:
*   `σ` (Sigma) = Standard deviation of valid reaction times within a session.
*   `μ` (Mu) = Arithmetic mean of valid reaction times within a session.

**Scientific Validity:**
A low CV indicates a tight clustering of reaction times around the mean — a state of "deep work" or "flow." A high CV indicates high intra-individual variability (IIV). Elevated IIV is consistently linked in neurological literature to attentional lapses, cognitive fatigue, sleep deprivation, and reduced white matter integrity in the frontal lobe.

**Implementation Thresholds:**
*   `CV < 0.15`: Excellent consistency (Flow state).
*   `0.15 ≤ CV ≤ 0.35`: Normal/Good consistency.
*   `CV > 0.35`: Elevated variability (Fatigue detected — triggers rest recommendations).

### System B: Exponential Moving Average (EMA) Drift

While CV captures overall session variability, it is a lagging indicator. To detect acute attentional lapses in real-time, NeuroSustain employs an EMA threshold system.

**Mathematical Definition:**
`EMA_t = α * RT_t + (1 - α) * EMA_{t-1}`
Where `α` (Alpha) is the smoothing factor (set to `0.2`), giving 20% weight to the current reaction time and 80% to the historical average.

**Business Logic:**
After a 5-trial warm-up period, the system establishes an `EMA_baseline`. If the user's `EMA_t` exceeds `EMA_baseline * 1.5` (a 50% degradation in sustained processing speed), the system flags an acute fatigue event. This instantly triggers a non-blocking UI intervention recommending a transition to the **Free Draw** refractory engine, allowing the Default Mode Network (DMN) to recover.

## 2. Adaptive Difficulty: Glicko-2

To maintain users in the "Zone of Proximal Development" (where tasks are neither too easy nor too frustrating), NeuroSustain uses the Glicko-2 rating system, originally developed for chess.

### Two-Tier Adaptation

NeuroSustain implements a hybrid difficulty model to keep users in the "Zone of Proximal Development":

1.  **Intra-session: Adaptive Staircase Procedure ("Cognitive Titration")**
    To account for real-time fluctuations in focus or fatigue, the system uses a **3-Up, 1-Down** protocol:
    *   **Subir (Escalada):** El usuario debe encadenar **3 aciertos consecutivos** para subir 1 nivel de dificultad. Esto garantiza que el ascenso se deba a competencia real y no a la suerte.
    *   **Bajar (Adaptación):** Un solo fallo o timeout reduce **inmediatamente** la dificultad en 1 nivel. Esto rompe la espiral de frustración y adapta la carga cognitiva al estado de fatiga actual.

2.  **Intersession: The "Phantom Opponent" Glicko-2 Model**
    In NeuroSustain, each exercise difficulty is treated as a "Phantom Opponent" with a Rating derived from the level:
    `Rating_Opponent = 1300 + (meanDifficulty - 1) * 100`
    
    The user's performance is scored as a composite of Accuracy and Focus. The Glicko-2 algorithm then recalibrates the user's permanent **Pillar Rating**, ensuring that future sessions begin at a calibrated "Warm-Up" baseline (usually 3 levels below their current peak).

## 3. Spaced Repetition: FSRS

NeuroSustain utilizes the Free Spaced Repetition Scheduler (FSRS) to determine *when* specific cognitive exercises should be reintroduced.

### The Memory Model

FSRS models human memory using three primary components:

1.  **Retrievability (`R`):** The probability that the user can successfully perform the task at a given moment. It decays exponentially over time according to the forgetting curve.
2.  **Stability (`S`):** The time required for Retrievability to decay from 100% to 90%. A higher stability means the neural pathway is stronger and will take longer to degrade.
3.  **Difficulty (`D`):** The inherent complexity of the task for that specific user.

**Mathematical Core (Simplified Forgetting Curve):**
`R = 90% ^ (t / S)`
Where `t` is the time elapsed since the last review.

**Implementation:**
After every session, the FSRS Web Worker analyzes the user's trial history. If a user struggles with a specific task (e.g., the Stroop Task), the algorithm lowers the `S` value for that task, scheduling it for review sooner. As the user's performance stabilizes, `S` increases, pushing the review interval further into the future, optimizing training time.

## 4. The "Focus Streak" Metric

Traditional apps measure streaks in days logged in. NeuroSustain measures *quality of attention*.

**Formula:**
`Focus Score = Accuracy × (1 / CV)`
*(Normalized to a 0-10 scale)*

**Rationale:**
A user who rapidly clicks through an exercise with 50% accuracy and wild reaction times (high CV) will receive a low Focus Score, breaking their streak, even if they spent 20 minutes in the app. A user who performs a 2-minute session with 95% accuracy and tight reaction times (low CV) maintains their streak. This metric directly gamifies *attention span* rather than *time spent*.

## 5. Clinical Exercise Design

NeuroSustain's exercises are digital implementations of validated clinical neuropsychological tests, adapted for continuous Glicko-2 difficulty scaling.

*   **Reaction Time (Processing Speed):** A pure measure of sensory-motor latency. At higher difficulty tiers, the engine introduces spatial randomization, "fakeout" distractor colors, and target drift to increase cognitive load.
*   **High Number (Inhibitory Control):** Based on the Numerical Stroop effect. Users must select the numerically larger number while ignoring incongruent physical font sizes (e.g., a massive "3" next to a tiny "8"). High difficulties introduce spatial rotation and multiple distractors.
*   **Serial Subtraction (Working Memory):** A classic clinical stress test. The user subtracts a specific number (e.g., 7) from a starting base (e.g., 100). The base is then scribbled out, forcing the user to hold the new base (93) in working memory for the next operation. High difficulties introduce "Zero-Allocation" rendering for frame-perfect 60fps tracking and faster "eraser" speeds to force phonological loop commitment.
*   **Piano Player (Auditory Working Memory):** An auditory sequence task. Users listen to a series of tones and must repeat them using a keyboard interface. It targets the phonological loop and sequential memory. High difficulty introduces spatial shuffling of the "keys" and reverse-order recall, requiring complex mental manipulation of the stored sequence.
*   **Fallacy Detector (Inhibitory Control + Critical Thinking):** Combats the "Go-Go-Go" pattern of social media consumption. Users are presented with logical arguments and must classify them as VALID or FALLACY. It requires the user to inhibit emotional reactions to the argument's content (e.g., ad hominem attacks) to focus on logical structure.
*   **Tower of Hanoi (Sustained Attention + Planning):** A classic planning task. Users must move a stack of discs from one peg to another with strict size constraints. It measures forward-thinking capacity and the ability to maintain a mental goal state across multiple sub-steps. High levels randomize start/end pegs to prevent rote memorization of the solution path.
*   **Set Switching (Cognitive Flexibility):** Based on the Wisconsin Card Sort Test (WCST). Users classify shapes based on changing rules (Color or Shape). It measures "Switch Cost"—the cognitive overhead required to dump an old rule set and load a new one.
*   **Word Scramble (Cognitive Flexibility):** Targets lexical retrieval and mental re-sequencing. High difficulty uses infrequent, longer words and introduces progressive "Hints" to prevent total cognitive block.
*   **Change Maker (Cognitive Flexibility + Working Memory):** A real-world math task where users must provide the exact change for a transaction using a limited tray of denominations. High difficulty introduces currency shuffling (MXN, USD, EUR) and forced "Optimal vs. Heuristic" constraints.
*   **Pattern Breaker (Sustained Attention):** A visual search task focused on detecting procedural anomalies within a symmetrical grid. It combats "Inattentional Blindness" by using relative scaling and subtle hue/rotation deltas that adapt via the staircase protocol.
*   **Symbol Search (Processing Speed):** Based on the WAIS-IV subtest. Users must identify if target symbols are present in a search array. It measures rapid visual scanning and decision-making under time pressure.
*   **3D Box Counting (Sustained Attention + Spatial):** Requires the user to count cubes in a 3D structure, including those obscured from view. Implemented via **Three.js** with InstancedMeshes to ensure zero-allocation performance on mobile hardware.
*   **Neural Storm (Cognitive Flexibility):** A 3-minute, high-intensity mode that switches active exercises every 30 seconds. It forces the brain to rapidly switch context rules. Because of its chaotic nature, trials completed in Neural Storm bypass the FSRS engine to prevent polluting the user's specific pillar stability metrics.
