import { Stack } from 'expo-router';
import { colors } from '@/constants/theme';

export default function ProfileStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Perfil' }} />
      <Stack.Screen name="admin" options={{ title: 'Administrar grupo' }} />
      <Stack.Screen name="admin-transactions" options={{ title: 'Confirmar transferencias' }} />
      <Stack.Screen name="admin-photos" options={{ title: 'Moderar fotos' }} />
      <Stack.Screen name="admin-attendance" options={{ title: 'Asignar días' }} />
    </Stack>
  );
}
