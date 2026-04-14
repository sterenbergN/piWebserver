import { normalizeBirthdate, parseBirthdateParts } from '@/lib/workout/birthdate';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very-active' | 'extra-active';

export type CalculatorDefaults = {
  calorie?: {
    heightInches?: number | '';
    weightLbs?: number | '';
    sex?: 'male' | 'female';
    age?: number | '';
    activityLevel?: ActivityLevel;
    goalRate?: number;
    timelineWeeks?: number;
    startDate?: string;
  };
  bodyFat?: {
    heightInches?: number | '';
    weightLbs?: number | '';
    sex?: 'male' | 'female';
    age?: number | '';
    neckInches?: number | '';
    waistInches?: number | '';
    hipInches?: number | '';
    forearmInches?: number | '';
    wristInches?: number | '';
    thighInches?: number | '';
    calfInches?: number | '';
  };
};

export const ACTIVITY_LEVELS: { value: ActivityLevel; label: string; multiplier: number; description: string }[] = [
  { value: 'sedentary', label: 'Sedentary', multiplier: 1.2, description: 'Desk-based days with little exercise.' },
  { value: 'light', label: 'Light', multiplier: 1.375, description: 'Light movement plus workouts about 1-2 times per week.' },
  { value: 'moderate', label: 'Moderate', multiplier: 1.55, description: 'Regular movement plus workouts around 3-4 times per week.' },
  { value: 'very-active', label: 'Very Active', multiplier: 1.725, description: 'Hard training or active work most days, about 5-6 sessions per week.' },
  { value: 'extra-active', label: 'Extra Active', multiplier: 1.9, description: 'Twice-daily training, heavy labor, or highly active days nearly every day.' },
];

export function parseHeightInches(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const directNumber = Number(trimmed);
  if (Number.isFinite(directNumber) && directNumber > 0) return directNumber;

  const feetInches = trimmed.match(/^(\d+)\s*'\s*(\d+)?(?:\s*")?$/);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inches = Number(feetInches[2] || 0);
    if (Number.isFinite(feet) && Number.isFinite(inches)) {
      return (feet * 12) + inches;
    }
  }

  return null;
}

export function deriveAgeFromBirthdate(value: unknown, referenceDate = new Date()): number | null {
  const normalized = normalizeBirthdate(value);
  const parts = parseBirthdateParts(normalized);
  if (!parts) return null;

  let age = referenceDate.getFullYear() - parts.year;
  const hasHadBirthday =
    referenceDate.getMonth() + 1 > parts.month ||
    (referenceDate.getMonth() + 1 === parts.month && referenceDate.getDate() >= parts.day);

  if (!hasHadBirthday) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

export function normalizeCalculatorDefaults(defaults: unknown): CalculatorDefaults {
  const source = defaults && typeof defaults === 'object' ? defaults as CalculatorDefaults : {};
  const calorie = source.calorie && typeof source.calorie === 'object' ? source.calorie : {};
  const bodyFat = source.bodyFat && typeof source.bodyFat === 'object' ? source.bodyFat : {};

  return {
    calorie: {
      heightInches: normalizeNumberField(calorie.heightInches),
      weightLbs: normalizeNumberField(calorie.weightLbs),
      sex: calorie.sex === 'female' ? 'female' : calorie.sex === 'male' ? 'male' : undefined,
      age: normalizeNumberField(calorie.age),
      activityLevel: ACTIVITY_LEVELS.some((entry) => entry.value === calorie.activityLevel)
        ? calorie.activityLevel
        : 'moderate',
      goalRate: normalizeGoalRate(calorie.goalRate),
      timelineWeeks: normalizeTimelineWeeks(calorie.timelineWeeks),
      startDate: normalizeDateString(calorie.startDate),
    },
    bodyFat: {
      heightInches: normalizeNumberField(bodyFat.heightInches),
      weightLbs: normalizeNumberField(bodyFat.weightLbs),
      sex: bodyFat.sex === 'female' ? 'female' : bodyFat.sex === 'male' ? 'male' : undefined,
      age: normalizeNumberField(bodyFat.age),
      neckInches: normalizeNumberField(bodyFat.neckInches),
      waistInches: normalizeNumberField(bodyFat.waistInches),
      hipInches: normalizeNumberField(bodyFat.hipInches),
      forearmInches: normalizeNumberField(bodyFat.forearmInches),
      wristInches: normalizeNumberField(bodyFat.wristInches),
      thighInches: normalizeNumberField(bodyFat.thighInches),
      calfInches: normalizeNumberField(bodyFat.calfInches),
    },
  };
}

export function buildSeededCalculatorDefaults(user: Record<string, any>): CalculatorDefaults {
  const normalizedDefaults = normalizeCalculatorDefaults(user?.calculatorDefaults);
  const profileHeight = parseHeightInches(user?.height);
  const profileWeight = normalizeNumberField(user?.weight);
  const derivedAge = deriveAgeFromBirthdate(user?.birthdate);
  const defaultSex = user?.gender === 'female' ? 'female' : 'male';

  return {
    calorie: {
      heightInches: normalizedDefaults.calorie?.heightInches ?? profileHeight ?? '',
      weightLbs: normalizedDefaults.calorie?.weightLbs ?? profileWeight ?? '',
      sex: normalizedDefaults.calorie?.sex ?? defaultSex,
      age: normalizedDefaults.calorie?.age ?? derivedAge ?? '',
      activityLevel: normalizedDefaults.calorie?.activityLevel ?? 'moderate',
      goalRate: normalizedDefaults.calorie?.goalRate ?? 0,
      timelineWeeks: normalizedDefaults.calorie?.timelineWeeks ?? 12,
      startDate: normalizedDefaults.calorie?.startDate ?? '',
    },
    bodyFat: {
      heightInches: normalizedDefaults.bodyFat?.heightInches ?? profileHeight ?? '',
      weightLbs: normalizedDefaults.bodyFat?.weightLbs ?? profileWeight ?? '',
      sex: normalizedDefaults.bodyFat?.sex ?? defaultSex,
      age: normalizedDefaults.bodyFat?.age ?? derivedAge ?? '',
      neckInches: normalizedDefaults.bodyFat?.neckInches ?? '',
      waistInches: normalizedDefaults.bodyFat?.waistInches ?? '',
      hipInches: normalizedDefaults.bodyFat?.hipInches ?? '',
      forearmInches: normalizedDefaults.bodyFat?.forearmInches ?? '',
      wristInches: normalizedDefaults.bodyFat?.wristInches ?? '',
      thighInches: normalizedDefaults.bodyFat?.thighInches ?? '',
      calfInches: normalizedDefaults.bodyFat?.calfInches ?? '',
    },
  };
}

export function calculateMifflinStJeor({
  sex,
  age,
  heightInches,
  weightLbs,
  activityLevel,
}: {
  sex: 'male' | 'female';
  age: number;
  heightInches: number;
  weightLbs: number;
  activityLevel: ActivityLevel;
}) {
  const weightKg = weightLbs * 0.45359237;
  const heightCm = heightInches * 2.54;
  const bmr = sex === 'female'
    ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161
    : (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5;
  const activityMultiplier = ACTIVITY_LEVELS.find((entry) => entry.value === activityLevel)?.multiplier ?? 1.55;
  const maintenanceCalories = bmr * activityMultiplier;

  return {
    bmr,
    maintenanceCalories,
    activityMultiplier,
  };
}

export function projectWeightTrend({
  sex,
  age,
  heightInches,
  startingWeightLbs,
  activityLevel,
  targetCalories,
  weeks = 12,
  startDate,
}: {
  sex: 'male' | 'female';
  age: number;
  heightInches: number;
  startingWeightLbs: number;
  activityLevel: ActivityLevel;
  targetCalories: number;
  weeks?: number;
  startDate?: string;
}) {
  const points: { week: number; weightLbs: number; maintenanceCalories: number; weeklyChangeLbs: number; dateLabel: string; shortDate: string }[] = [];
  let currentWeight = startingWeightLbs;
  const parsedStartDate = startDate ? new Date(`${startDate}T12:00:00`) : null;

  for (let week = 1; week <= weeks; week++) {
    const maintenanceCalories = calculateMifflinStJeor({
      sex,
      age,
      heightInches,
      weightLbs: currentWeight,
      activityLevel,
    }).maintenanceCalories;
    const weeklyChangeLbs = ((targetCalories - maintenanceCalories) * 7) / 3500;
    currentWeight += weeklyChangeLbs;
    const projectedDate = parsedStartDate ? new Date(parsedStartDate) : null;
    if (projectedDate) {
      projectedDate.setDate(projectedDate.getDate() + (week * 7));
    }

    points.push({
      week,
      weightLbs: Number(currentWeight.toFixed(1)),
      maintenanceCalories: Math.round(maintenanceCalories),
      weeklyChangeLbs: Number(weeklyChangeLbs.toFixed(2)),
      dateLabel: projectedDate ? formatShortDate(projectedDate) : `Week ${week}`,
      shortDate: projectedDate ? formatShortDate(projectedDate) : '',
    });
  }

  return points;
}

export function estimateBodyFatNavy({
  sex,
  heightInches,
  weightLbs,
  neckInches,
  waistInches,
  hipInches,
}: {
  sex: 'male' | 'female';
  heightInches: number;
  weightLbs: number;
  neckInches: number;
  waistInches: number;
  hipInches?: number;
}) {
  const denominator = Math.log10(heightInches);
  const bodyFatPercentage = sex === 'female'
    ? 163.205 * Math.log10(waistInches + (hipInches || 0) - neckInches) - 97.684 * denominator - 78.387
    : 86.01 * Math.log10(waistInches - neckInches) - 70.041 * denominator + 36.76;

  const safeBodyFat = clamp(Number(bodyFatPercentage.toFixed(1)), 2, 75);
  const fatMassLbs = Number(((weightLbs * safeBodyFat) / 100).toFixed(1));
  const leanMassLbs = Number((weightLbs - fatMassLbs).toFixed(1));

  return {
    bodyFatPercentage: safeBodyFat,
    fatMassLbs,
    leanMassLbs,
  };
}

export function estimateBodyFatCovertBailey({
  sex,
  age,
  waistInches,
  hipInches,
  forearmInches,
  wristInches,
  thighInches,
  calfInches,
}: {
  sex: 'male' | 'female';
  age: number;
  waistInches?: number;
  hipInches?: number;
  forearmInches?: number;
  wristInches: number;
  thighInches?: number;
  calfInches?: number;
}) {
  const isYounger = age <= 30;
  const percentage = sex === 'female'
    ? (hipInches || 0) + ((isYounger ? 0.8 : 1) * (thighInches || 0)) - (2 * (calfInches || 0)) - wristInches
    : (waistInches || 0) + (0.5 * (hipInches || 0)) - ((isYounger ? 3 : 2.7) * (forearmInches || 0)) - wristInches;

  return clamp(Number(percentage.toFixed(1)), 2, 75);
}

export function calculateBmi(weightLbs: number, heightInches: number) {
  const bmi = (weightLbs / (heightInches * heightInches)) * 703;
  return Number(bmi.toFixed(1));
}

function normalizeNumberField(value: unknown): number | '' | undefined {
  if (value === '') return '';
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Number(parsed.toFixed(2));
  }
  return undefined;
}

function normalizeGoalRate(value: unknown): number {
  const parsed = Number(value);
  const allowed = new Set([-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]);
  return allowed.has(parsed) ? parsed : 0;
}

function normalizeTimelineWeeks(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 8 && parsed <= 50 && parsed % 2 === 0 ? parsed : 12;
}

function normalizeDateString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
