import { Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
      <Stack.Screen name="admin-transactions" options={{ title: 'Confirmar transferencias' }} />
      <Stack.Screen name="admin-photos" options={{ title: 'Moderar fotos' }} />
      <Stack.Screen name="admin-members" options={{ title: 'Administrar Miembros' }} />
      <Stack.Screen name="excuse-admin" options={{ title: 'Excusas' }} />
      <Stack.Screen name="permissions" options={{ title: 'Permisos' }} />
      <Stack.Screen name="badges" options={{ title: 'Logros' }} />
      <Stack.Screen name="stats" options={{ title: 'Estadísticas' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Editar perfil' }} />
      <Stack.Screen name="change-password" options={{ title: 'Cambiar contraseña' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Eliminar cuenta' }} />
      <Stack.Screen name="admin-edit-group" options={{ title: 'Editar grupo' }} />
      <Stack.Screen name="invite" options={{ title: 'Invitar' }} />
    </Stack>
  );
}
