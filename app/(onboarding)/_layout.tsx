import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/constants/theme';

export default function OnboardingLayout() {
  const { isInitializing, isSignedIn } = useAuth();

  if (isInitializing) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="create-group" options={{ title: 'Crear grupo' }} />
      <Stack.Screen name="join-group" options={{ title: 'Unirme a un grupo' }} />
      <Stack.Screen name="deposit" options={{ title: 'Depósito inicial', headerBackVisible: false }} />
    </Stack>
  );
}
