import { Stack } from 'expo-router';
import { colors } from '@/constants/theme';

export default function CheckinStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Check-in' }} />
      <Stack.Screen name="preview" options={{ title: 'Confirmar', presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
