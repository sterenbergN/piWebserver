# Brainstorming Session

## 7. Progressive Overload for High-Rep Lifts
For lifts that typically require higher reps before weight increases (such as calf raises, core exercises, or lateral raises), the standard progression model might be too eager to jump in weight.
Ideas:
- **Rep Progression Bias:** Automatically detect these lifts based on the primary muscle group (e.g., 'Calves', 'Core', 'Shoulders' if isolation). Increase the \`maxReps\` constraint (e.g., to 20 or 25) and strongly prefer rep increases until the upper bound is reached. Only then allow a weight jump.
- **Micro-loading:** Utilize smaller increments if available, but if not, force the system to milk every last rep out of the current weight before advancing.
- **RIR Thresholding:** Require an average RIR of 3+ over multiple sessions before advancing the weight, to ensure the tendon/joint is fully adapted to the load.

## 8. Deloading Implementation Ideas
Deloading is crucial for avoiding overtraining and managing fatigue, but we don't want to force it upon the user.
Ideas:
- **Manual Toggle:** Add a "Deload Session" switch in the active tracker. When toggled, it halves the intensity factor (e.g., to 0.5) for that workout, naturally prompting the progression engine to suggest lighter weights or fewer sets.
- **Auto-Prompting:** Analyze the history trend. If the user's performance score consistently dips below 0.9 for 3-4 consecutive workouts (showing a stall), show a banner or popup suggesting a deload week. If they accept, lower the intensity globally for 7 days.
- **Volume Reduction vs Intensity Reduction:** Allow the user to choose whether they want a "Volume Deload" (same weight, half sets) or an "Intensity Deload" (same sets, 60% weight).

## 9. Advanced Analytics Page Improvements
The Advanced Analytics page could provide deeper insights.
Ideas:
- **Volume per Muscle Group (Pie Chart):** A breakdown showing how total volume is distributed across chest, back, legs, etc., helping identify undertrained or overtrained muscles.
- **Consistency Heatmap:** A GitHub-style contribution graph showing which days the user worked out over the past year.
- **Estimated 1RM Trends:** A multi-line chart tracking the e1RM progression of the "Big 3" (Bench, Squat, Deadlift) over time on the same axes to visualize relative strength gains.
