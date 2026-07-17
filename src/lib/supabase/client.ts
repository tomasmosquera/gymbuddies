import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { IS_SUPABASE_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/constants/config';
import type { Database } from './types';

// AsyncStorage (not SecureStore) on purpose: Supabase session payloads
// routinely exceed the ~2048 byte per-item limit iOS Keychain imposes on
// expo-secure-store, which silently breaks session persistence. This is
// Supabase's own documented recommendation for Expo apps.
export const supabase = createClient<Database>(
  IS_SUPABASE_CONFIGURED ? SUPABASE_URL : 'https://placeholder.supabase.co',
  IS_SUPABASE_CONFIGURED ? SUPABASE_ANON_KEY : 'placeholder-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
