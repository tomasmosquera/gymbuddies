import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface LeagueChampionsState {
  /** Which group championIds belongs to — an avatar only honors it while this is still the active group. */
  groupId: string | null;
  /** user_ids that finished 1st (ties included) in the group's most recently COMPLETED league cycle. */
  championIds: string[];
  setChampions: (groupId: string | null, championIds: string[]) => void;
}

/**
 * Who wears the crown right now, for the active group. Persisted (like
 * activeGroupStore) so a cold start already has the last known winners on
 * the very first frame — otherwise every avatar would render initials and
 * then visibly swap to a crown once the network answers.
 */
export const useLeagueChampionsStore = create<LeagueChampionsState>()(
  persist(
    (set) => ({
      groupId: null,
      championIds: [],
      setChampions: (groupId, championIds) => set({ groupId, championIds }),
    }),
    {
      name: 'gymbuddies-league-champions',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
