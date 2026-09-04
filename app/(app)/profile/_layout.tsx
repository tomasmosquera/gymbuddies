import { Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { colors } from '@/constants/theme';

// Reached directly from a push notification tap (category 'money' ->
// /profile/wallet, see notificationRouting.ts) as well as from a normal
// in-tab push — a direct notification jump can land here with no "index"
// beneath it in this stack's history, so the default back button never
// appears. Always falls back to /profile when there's nothing to go back to.
function WalletBackButton() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
      hitSlop={12}
      accessibilityRole="button"
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );
}

// Every screen that only ever makes sense as a child of the admin panel
// (edit group, invite, review transfers/excuses, moderate photos, manage
// members, the full activity list) — Administrar grupo is their one and
// only real parent, whether reached the normal way (Perfil → Administrar
// grupo → tool) or by pushing straight from an admin_only membership's
// repurposed Check-in tab (see checkin/index.tsx), which sits completely
// outside this Stack and leaves no real history beneath these screens —
// the default back button doesn't reliably show, and even router.back()
// itself can't be trusted to land on Admin rather than wherever this
// Stack's own initial route happens to be. Deliberately unconditional
// (never router.back()/canGoBack()) — /profile/admin is correct 100% of
// the time here regardless of how the screen was reached, so there's no
// case where always replacing to it is the wrong call.
function AdminChildBackButton() {
  return (
    <Pressable onPress={() => router.replace('/profile/admin')} hitSlop={12} accessibilityRole="button">
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );
}

// Invite is the one admin-panel-adjacent screen with a second, legitimate,
// non-admin entry point (Perfil's own top-bar invite icon, shown to any
// member). Falling back unconditionally to /profile/admin like the other
// admin-only children would send a regular member into the admin panel —
// content their role was never meant to see. Role-aware instead: an admin
// (however they got here) lands on Admin; anyone else lands on Perfil.
function InviteBackButton() {
  const { membership } = useActiveGroup();
  return (
    <Pressable
      onPress={() => router.replace(membership?.role === 'admin' ? '/profile/admin' : '/profile')}
      hitSlop={12}
      accessibilityRole="button"
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );
}

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
      <Stack.Screen name="notifications" options={{ title: 'Notificaciones' }} />
      <Stack.Screen name="wallet" options={{ title: 'Mi saldo', headerLeft: () => <WalletBackButton /> }} />
      <Stack.Screen name="wallet-recharge" options={{ title: 'Recargar' }} />
      <Stack.Screen name="admin" options={{ title: 'Administrar grupo' }} />
      <Stack.Screen name="admin-dashboard" options={{ title: 'Panel de administrador' }} />
      <Stack.Screen
        name="admin-activity"
        options={{ title: 'Actividad reciente', headerLeft: () => <AdminChildBackButton /> }}
      />
      <Stack.Screen
        name="admin-transactions"
        options={{ title: 'Confirmar transferencias', headerLeft: () => <AdminChildBackButton /> }}
      />
      <Stack.Screen
        name="admin-photos"
        options={{ title: 'Moderar fotos', headerLeft: () => <AdminChildBackButton /> }}
      />
      <Stack.Screen
        name="admin-members"
        options={{ title: 'Administrar Miembros', headerLeft: () => <AdminChildBackButton /> }}
      />
      <Stack.Screen name="excuse-admin" options={{ title: 'Excusas', headerLeft: () => <AdminChildBackButton /> }} />
      <Stack.Screen name="settings" options={{ title: 'Configuración' }} />
      <Stack.Screen name="notification-preferences" options={{ title: 'Notificaciones' }} />
      <Stack.Screen name="badges" options={{ title: 'Logros' }} />
      <Stack.Screen name="stats" options={{ title: 'Estadísticas' }} />
      <Stack.Screen name="platform-dashboard" options={{ title: 'Panel de la plataforma' }} />
      <Stack.Screen name="king-of-the-hill" options={{ title: 'King of the Hill' }} />
      <Stack.Screen name="king-of-the-hill-exercise" options={{ title: 'King of the Hill' }} />
      <Stack.Screen name="king-of-the-hill-claim" options={{ title: 'Reclamar récord' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Editar perfil' }} />
      <Stack.Screen name="change-password" options={{ title: 'Cambiar contraseña' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Eliminar cuenta' }} />
      <Stack.Screen
        name="admin-edit-group"
        options={{ title: 'Editar grupo', headerLeft: () => <AdminChildBackButton /> }}
      />
      <Stack.Screen name="invite" options={{ title: 'Invitar', headerLeft: () => <InviteBackButton /> }} />
    </Stack>
  );
}
