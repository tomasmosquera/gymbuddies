import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { KothExercise } from '@/lib/supabase/types';

/** The fixed, global King of the Hill exercise catalog — same for every group, rarely changes. */
export function useKothCatalog() {
  const [exercises, setExercises] = useState<KothExercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('koth_exercises')
      .select('*')
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        setExercises(data ?? []);
        setIsLoading(false);
      });
  }, []);

  return { exercises, isLoading };
}
