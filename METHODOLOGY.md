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

### Why Glicko-2 over ELO?

The standard ELO system assumes a player's rating is a fixed point. Glicko-2 introduces the concept of **Rating Deviation (RD)** — a measure of uncertainty.

*   **Rating (`r`):** The system's best estimate of the user's skill level in a specific cognitive pillar.
*   **Rating Deviation (`RD`):** The confidence interval. If a user hasn't trained Working Memory in a month, their `RD` increases (uncertainty grows).
*   **Volatility (`σ`):** Measures the degree of expected fluctuation. High volatility indicates the user is in a phase of rapid learning or rapid decline.

**Business Logic:**
In NeuroSustain, each exercise difficulty level is treated as an "opponent" with a fixed rating. When a user completes a session, their performance (Accuracy and Focus Score) determines the "match outcome." The Glicko-2 algorithm then recalibrates the user's rating, ensuring the next session's difficulty is mathematically tuned to their current capability.

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
*   **Serial Subtraction (Working Memory):** A classic clinical stress test. The user subtracts a specific number (e.g., 7) from a starting base (e.g., 100). The base is then scribbled out, forcing the user to hold the new base (93) in working memory for the next operation. High difficulties introduce direction flips (subtraction to addition).
*   **Neural Storm (Cognitive Flexibility):** A 3-minute, high-intensity mode that switches active exercises every 30 seconds. It forces the brain to rapidly switch context rules. Because of its chaotic nature, trials completed in Neural Storm bypass the FSRS engine to prevent polluting the user's specific pillar stability metrics.
