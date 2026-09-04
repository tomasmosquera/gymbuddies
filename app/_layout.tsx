import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useAuthBootstrap } from '@/hooks/useAuth';
import { useAppleHealthForegroundSync, useAppleHealthOnboardingPrompt } from '@/hooks/useAppleHealth';
import { useNotificationTapRouting } from '@/hooks/useNotificationTapRouting';
import { useDeferredInviteCode } from '@/hooks/useDeferredInviteCode';
import { useAppUpdateCheck } from '@/hooks/useAppUpdateCheck';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { colors } from '@/constants/theme';
import '@/lib/notifications/checkoutGeofenceTask';
import '@/lib/notifications/checkinArrivalGeofenceTask';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
            {/* group-select controls its own headerLeft (see its own useLayoutEffect) —
                it's the only component that can reliably tell whether it was reached
                from Profile > "Cambiar de grupo" (real back target) or a cold-start
                redirect chain with nowhere to go back to. Default here is no back
                button at all, so there's nothing to flash before that effect runs. */}
            <Stack.Screen name="group-select" options={{ title: 'Mis grupos', headerLeft: () => null }} />
            <Stack.Screen name="join/[code]" options={{ title: 'Invitación' }} />
          </Stack>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
