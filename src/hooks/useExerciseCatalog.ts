import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Exercise } from '@/lib/supabase/types';

/** The fixed, global exercise catalog — same for every group and every routine, rarely changes. */
export function useExerciseCatalog() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('exercises')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data }) => {
        setExercises(data ?? []);
        setIsLoading(false);
      });
  }, []);

  return { exercises, isLoading };
}
