// Data and handlers the analytics page passes down to its tabs.

import type { IntensityLabel } from '@/lib/workout/intensity';
import type { ProgressReview } from '@/lib/workout/progression';

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
  reviewFor: (entry: any) => ProgressReview | undefined;
  avgAchievedGrowth: number;
  avgExpectedGain: number;
  targetRir: number;
  popup: React.ReactNode;
};
