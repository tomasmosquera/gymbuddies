import { Stack } from 'expo-router';
import { colors } from '@/constants/theme';

export default function WalletStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Mi saldo' }} />
      <Stack.Screen name="recharge" options={{ title: 'Recargar' }} />
    </Stack>
  );
}
