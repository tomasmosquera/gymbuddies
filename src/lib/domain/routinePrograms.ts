import type { Routine } from '@/lib/supabase/types';

export interface RoutineProgramGroup<T extends Routine> {
  /** null means `routines` has exactly one entry that stands on its own — not really a "program" card, just a routine shown at the same level as one. */
  programName: string | null;
  /** Ordered by program_order for a real program; a single entry for a standalone routine. */
  routines: T[];
}

/**
 * Groups routines that share a `program_name` (StrongLifts 5x5's two days, Push Pull Legs' three,
 * Upper Lower's two) into one entry each, in `program_order`; everything else (program_name null)
 * becomes its own single-routine group, same shape either way so the browse screen doesn't need two
 * separate render paths. Groups themselves sort by name (the program's, or the lone routine's) so the
 * list stays stable regardless of insertion order.
 */
export function groupRoutinesByProgram<T extends Routine>(routines: readonly T[]): RoutineProgramGroup<T>[] {
  const standalone: RoutineProgramGroup<T>[] = [];
  const programs = new Map<string, T[]>();
  for (const routine of routines) {
    if (routine.program_name === null) {
      standalone.push({ programName: null, routines: [routine] });
      continue;
    }
    const existing = programs.get(routine.program_name);
    if (existing) existing.push(routine);
    else programs.set(routine.program_name, [routine]);
  }
  const grouped: RoutineProgramGroup<T>[] = [...programs.entries()].map(([programName, groupRoutines]) => ({
    programName,
    routines: [...groupRoutines].sort((a, b) => (a.program_order ?? 0) - (b.program_order ?? 0)),
  }));
  return [...grouped, ...standalone].sort((a, b) =>
    (a.programName ?? a.routines[0].name).localeCompare(b.programName ?? b.routines[0].name, 'es')
  );
}
