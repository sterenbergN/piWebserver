// Data and handlers the analytics page passes down to its tabs.

import type { IntensityLabel } from '@/lib/workout/intensity';

export type AnalyticsTabProps = {
  oneRMs: any[];
  prTimeline: any[];
  history: any[];
  muscleFatigue: any[];
  recoveryData: any[];
  overloadTracking: any[];
  calibrations: any[];
  volumeTimeline: any[];
  calorieTimeline: any[];
  muscleVolumeData: any[];
  missingWilks: string[];
  calibrationByLift: Record<string, any[]>;
  trainingHeatmap: Map<string, { setCount: number; lifts: string[] }>;
  allLiftsMap: Map<string, string>;
  gymNameMap: Map<string, string>;
  user: any;
  experience: any;
  intensityFactor: number;
  intensityInfo: IntensityLabel;
  intensitySaved: boolean;
  intensitySaving: boolean;
  setIntensityFactor: (value: number) => void;
  setIntensitySaved: (value: boolean) => void;
  handleSaveIntensity: () => void;
  lbm: number;
  wilks: number;
  isDemo: boolean;
  handleDeleteLog: (id: string) => void;
  handleDownloadCsv: () => void;
  getScaleFactorForLiftDisplay: (workout: any, liftId: string) => number;
  achievedRatio: (entry: any) => number;
  targetRatioFor: (entry: any) => number;
  avgAchievedGrowth: number;
  avgTargetGrowth: number;
  strengthWeight: number;
  popup: React.ReactNode;
};
