import { Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useAuthBootstrap } from '@/hooks/useAuth';
import { useAppleHealthForegroundSync, useAppleHealthOnboardingPrompt } from '@/hooks/useAppleHealth';
import { useNotificationTapRouting } from '@/hooks/useNotificationTapRouting';
import { useDeferredInviteCode } from '@/hooks/useDeferredInviteCode';
import { useAppUpdateCheck } from '@/hooks/useAppUpdateCheck';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { colors } from '@/constants/theme';
import '@/lib/notifications/checkoutGeofenceTask';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Explicit chevron-only back button, icon-only regardless of platform (no
// "< (app)" back title — that came from the previous route's title, which
// this stack leaves unset for the "(app)" segment). Reached from Profile >
// "Cambiar de grupo" (has history to pop) as well as a cold-start redirect
// with no membership (nothing to go back to) — only rendered when there's
// actually somewhere to go, same as WalletBackButton in profile/_layout.tsx.
function GroupSelectBackButton() {
  if (!router.canGoBack()) return null;
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );
}

export default function RootLayout() {
  useAuthBootstrap();
  useAppleHealthOnboardingPrompt();
  useAppleHealthForegroundSync();
  useNotificationTapRouting();
  useDeferredInviteCode();
  useAppUpdateCheck();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ErrorBoundary>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
            <Stack.Screen
              name="group-select"
              options={{ title: 'Mis grupos', headerLeft: () => <GroupSelectBackButton /> }}
            />
            <Stack.Screen name="join/[code]" options={{ title: 'Invitación' }} />
          </Stack>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
