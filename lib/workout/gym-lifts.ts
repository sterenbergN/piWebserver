import type { Gym, Lift, Station } from './types';

// Every lift at a gym, each with the machine it's on: what a workout picks from
// (to plan, to add, to change a lift). Built when the workout starts, and again
// whenever equipment is edited during it, so a machine deleted or changed in the
// equipment panel doesn't linger in "Change lift" with its old weights.

export type GymLift = Lift & { station: Station; gymName: string; gymId: string };

export function liftsOfGym(gym: Pick<Gym, 'id' | 'name' | 'stations'>): GymLift[] {
  return (gym.stations ?? []).flatMap((station) => (station.lifts ?? []).map((lift) => ({ ...lift, station, gymName: gym.name, gymId: gym.id })));
}

/** The list with one gym's lifts replaced by what that gym has now. */
export function withGymLifts<T extends { gymId?: string }>(list: T[], gym: Pick<Gym, 'id' | 'name' | 'stations'>): (T | GymLift)[] {
  return [...list.filter((l) => l.gymId !== gym.id), ...liftsOfGym(gym)];
}
