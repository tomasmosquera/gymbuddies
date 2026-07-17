import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ActiveGroupState {
  activeGroupId: string | null;
  setActiveGroupId: (groupId: string | null) => void;
}

export const useActiveGroupStore = create<ActiveGroupState>()(
  persist(
    (set) => ({
      activeGroupId: null,
      setActiveGroupId: (groupId) => set({ activeGroupId: groupId }),
    }),
    {
      name: 'gymbuddies-active-group',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
