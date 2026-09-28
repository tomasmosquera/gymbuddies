import { Stack } from 'expo-router';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { colors } from '@/constants/theme';

export default function CheckinStackLayout() {
  // An admin_only member never checks in — this whole tab renders the group
  // admin panel instead (see checkin/index.tsx) — so its own header title
  // must say so too, not just the tab bar label set in (app)/_layout.tsx.
  const { membership } = useActiveGroup();
  const isAdminOnly = membership?.status === 'admin_only';

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        // Every screen's own title can be long ("¿Qué vas a entrenar?") —
        // the default back button repeats whatever screen you came from
        // instead, which can be just as long. A fixed short "Atrás" instead.
        headerBackTitle: 'Atrás',
      }}
    >
      <Stack.Screen name="index" options={{ title: isAdminOnly ? 'Panel de administrador' : 'Check-in' }} />
      <Stack.Screen name="preview" options={{ title: 'Confirmar', presentation: 'fullScreenModal' }} />
      {/* Deliberately NOT presentation: 'fullScreenModal' — preview.tsx (which IS one) replaces itself with this
          screen right after a successful check-in, and replacing one modal with another modal (rather than a
          normal screen, like the pre-existing '/home' redirect this mirrors) is the one untested combination in
          this codebase; suspected of dismissing back to `index` instead of presenting this screen. */}
      <Stack.Screen name="routine-choice" options={{ title: '¿Qué vas a entrenar?', headerBackVisible: false, gestureEnabled: false }} />
    </Stack>
  );
}
