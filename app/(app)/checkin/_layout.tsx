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
      }}
    >
      <Stack.Screen name="index" options={{ title: isAdminOnly ? 'Panel de administrador' : 'Check-in' }} />
      <Stack.Screen name="preview" options={{ title: 'Confirmar', presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
