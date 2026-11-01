'use client';

import { BLUEPRINT } from '@/lib/study/coverage';

const labelOf = (system: string) => BLUEPRINT.find((b) => b.system === system)?.label ?? system;

/** What to draw from: everything, a class, or an organ system. */
export function Scope({ options, course, system, setCourse, setSystem }: { options: { courses: string[]; systems: string[] }; course: string; system: string; setCourse: (v: string) => void; setSystem: (v: string) => void }) {
  return (
    <div className="sd-fields">
      {options.courses.length > 0 && (
        <label>Class
          <select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All classes</option>
            {options.courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {options.systems.length > 0 && (
        <label>Organ system
          <select value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">All systems</option>
            {options.systems.map((s) => <option key={s} value={s}>{labelOf(s)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
