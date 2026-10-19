import { create } from 'zustand';
import type { Exercise } from '@/lib/supabase/types';

interface ExercisePickerDetourState {
  /** Set by whichever screen's ExercisePickerModal the member left via a row's info ("i")
   * button, right before pushing exercise-detail — a closure that reopens that exact picker
   * (which mode: "+ Agregar ejercicio" vs. workout-session.tsx's "Reemplazar") once this screen
   * regains focus. Without this, coming back from exercise-detail would land on the host screen
   * with the picker gone, instead of back where the member actually was. Read and cleared once
   * by that screen's own focus effect; left alone if `addToRoutine`/`addToSession` fires instead. */
  reopenPicker: (() => void) | null;
  setReopenPicker: (fn: (() => void) | null) => void;
  /** Set by exercise-detail's own "Agregar a la rutina" button (only shown there when reached via
   * RoutineExerciseListEditor's picker) — the exercise to append once back on that screen,
   * instead of reopening the picker. */
  addToRoutine: Exercise | null;
  setAddToRoutine: (exercise: Exercise | null) => void;
  /** Same idea as addToRoutine, for exercise-detail's "Agregar al entreno" button — only shown
   * when reached via workout-session.tsx's own "+ Agregar ejercicio" (not its "Reemplazar",
   * which needs the member's session-specific confirmation and isn't offered from here). */
  addToSession: Exercise | null;
  setAddToSession: (exercise: Exercise | null) => void;
}

export const useExercisePickerDetourStore = create<ExercisePickerDetourState>((set) => ({
  reopenPicker: null,
  setReopenPicker: (fn) => set({ reopenPicker: fn }),
  addToRoutine: null,
  setAddToRoutine: (exercise) => set({ addToRoutine: exercise }),
  addToSession: null,
  setAddToSession: (exercise) => set({ addToSession: exercise }),
}));
