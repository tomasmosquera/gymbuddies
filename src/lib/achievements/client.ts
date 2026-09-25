import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

/**
 * The Supabase client the achievements code runs against, passed in rather than
 * imported: the app hands it its own client, and the notify-achievements Edge
 * Function hands it a service-role one. Nothing under src/lib/achievements may
 * depend on the app's global client module (React Native / AsyncStorage) —
 * that is what keeps this folder runnable in Deno.
 */
export type AchievementsClient = SupabaseClient<Database>;
