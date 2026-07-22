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
      <Stack.Screen name="wallet" options={{ title: 'Mi saldo' }} />
      <Stack.Screen name="wallet-recharge" options={{ title: 'Recargar' }} />
      <Stack.Screen name="admin" options={{ title: 'Administrar grupo' }} />
      <Stack.Screen name="admin-transactions" options={{ title: 'Confirmar transferencias' }} />
      <Stack.Screen name="admin-photos" options={{ title: 'Moderar fotos' }} />
      <Stack.Screen name="admin-members" options={{ title: 'Administrar Miembros' }} />
      <Stack.Screen name="permissions" options={{ title: 'Permisos' }} />
      <Stack.Screen name="change-password" options={{ title: 'Cambiar contraseña' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Eliminar cuenta' }} />
      <Stack.Screen name="admin-edit-group" options={{ title: 'Editar grupo' }} />
    </Stack>
  );
}
