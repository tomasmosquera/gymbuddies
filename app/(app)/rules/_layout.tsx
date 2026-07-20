import { Stack } from 'expo-router';
import { colors } from '@/constants/theme';

export default function RulesStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Reglas del grupo' }} />
      <Stack.Screen name="propose" options={{ title: 'Proponer cambio' }} />
      <Stack.Screen name="excuse-request" options={{ title: 'Solicitar excusa' }} />
      <Stack.Screen name="excuse-admin" options={{ title: 'Revisar excusas' }} />
    </Stack>
  );
}
