import { Pressable } from 'react-native';
import { Redirect, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/constants/theme';

// create-group/join-group/browse-public-groups are always reached by a
// button tap from group-select — which lives in the ROOT stack, outside
// this (onboarding) group's own nested Stack. Since this nested Stack's own
// history starts empty at whichever of these was pushed, its default back
// button never appears (index 0 within THIS navigator), even though
// router.back() itself still correctly pops all the way out to group-select
// underneath. Same root cause/fix as WalletBackButton in profile/_layout.tsx.
function OnboardingBackButton() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/group-select'))}
      hitSlop={12}
      accessibilityRole="button"
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );
}

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
      <Stack.Screen
        name="create-group"
        options={{ title: 'Crear grupo', headerLeft: () => <OnboardingBackButton /> }}
      />
      <Stack.Screen
        name="join-group"
        options={{ title: 'Unirme a un grupo', headerLeft: () => <OnboardingBackButton /> }}
      />
      <Stack.Screen
        name="browse-public-groups"
        options={{ title: 'Grupos públicos', headerLeft: () => <OnboardingBackButton /> }}
      />
      <Stack.Screen name="deposit" options={{ title: 'Depósito inicial', headerBackVisible: false }} />
    </Stack>
  );
}
