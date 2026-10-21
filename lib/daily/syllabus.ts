// The syllabus topics per track, with how often each comes up (3 = often).
// Mirrors scripts/daily-generator/syllabus.md (keep the names identical) so
// the analysis can say which topics you haven't tried yet.

import type { Track } from './types';

export const SYLLABUS: Record<Track, [topic: string, weight: number][]> = {
  mechanical: [
    ['Statics', 3], ['Mechanics of materials', 3], ['Machine design', 3], ['Dynamics', 2], ['Thermodynamics', 3],
    ['Heat transfer', 2], ['Fluid mechanics', 3], ['HVAC & refrigeration', 1], ['Vibrations', 2], ['Materials', 2],
    ['Manufacturing & GD&T', 1], ['Engineering economics', 2], ['Measurement', 1], ['Circuits', 2], ['Mathematics', 2],
    ['Chemistry & combustion', 1],
  ],
  controls: [
    ['Modeling', 3], ['Block diagrams', 2], ['Time response', 3], ['Routh–Hurwitz', 2], ['Steady-state error', 2],
    ['Root locus', 2], ['Frequency response', 3], ['Compensator design', 2], ['PID control', 3], ['PID tuning', 2],
    ['On–off control', 1], ['Digital control', 2], ['State space', 2], ['Advanced loop structures', 1],
    ['System identification', 1], ['Nonlinearities', 1],
  ],
  automation: [
    ['IEC 61131-3', 2], ['TIA Portal', 3], ['Timers, counters and edges', 2], ['Ladder logic', 2], ['State machines', 2],
    ['ISA-88 batch control', 1], ['ISA-95', 1], ['HMI and alarms', 1], ['Analog I/O and scaling', 2],
    ['Industrial networks', 2], ['Drives', 2], ['Motion and sensors', 1], ['Machine safety', 2], ['Functional safety', 2],
    ['Electrical design', 1], ['Testing and commissioning', 1], ['Industrial cybersecurity', 1],
  ],
};
