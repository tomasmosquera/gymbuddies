import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/constants/theme';

export default function AuthLayout() {
  const { isInitializing, isSignedIn } = useAuth();

  if (!isInitializing && isSignedIn) {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: '' }} />
      <Stack.Screen name="sign-up" options={{ title: '' }} />
    </Stack>
  );
}
