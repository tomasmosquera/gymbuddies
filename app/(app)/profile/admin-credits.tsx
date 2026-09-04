import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';
import { colors, spacing, typography } from '@/constants/theme';

// Same UI-only gate as create-group.tsx/admin-edit-group.tsx — the real
// authority is server-side (both RPCs below check profiles.is_platform_admin
// themselves), this only decides who sees the screen at all. Unlike every
// other admin screen in the app, this one isn't scoped to any group.
const PLATFORM_ADMIN_EMAIL = 'tomasmosquera@hotmail.com';

interface FoundUser {
  id: string;
  fullName: string;
  credits: number;
}

export default function AdminCreditsScreen() {
  const { session } = useAuth();
  const isPlatformAdmin = session?.user.email === PLATFORM_ADMIN_EMAIL;

  const [email, setEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [amount, setAmount] = useState('');
  const [isGranting, setIsGranting] = useState(false);

  if (!isPlatformAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.subtitle}>No tienes acceso a esta pantalla.</Text>
      </View>
    );
  }

  const handleSearch = async () => {
    if (!email.trim()) return;
    setIsSearching(true);
    setFoundUser(null);
    try {
      const { data, error } = await supabase.rpc('admin_find_user_by_email', { p_email: email.trim() });
      if (error) throw new Error(error.message);
      const row = data?.[0];
      if (!row) {
        Alert.alert('No encontrado', 'No hay ningún usuario registrado con ese correo.');
        return;
      }
      setFoundUser({ id: row.id, fullName: row.full_name, credits: row.group_creation_credits });
    } catch (err) {
      Alert.alert('No se pudo buscar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSearching(false);
    }
  };

  const handleGrant = async () => {
    if (!foundUser) return;
    const numeric = Number(amount);
    if (!amount || Number.isNaN(numeric) || numeric === 0) {
      Alert.alert('Monto inválido', 'Ingresa un número distinto de 0 (negativo para quitar créditos).');
      return;
    }
    setIsGranting(true);
    try {
      const { data, error } = await supabase.rpc('admin_grant_group_creation_credits', {
        p_user_id: foundUser.id,
        p_amount: numeric,
      });
      if (error) throw new Error(error.message);
      setFoundUser({ ...foundUser, credits: data ?? foundUser.credits });
      setAmount('');
      Alert.alert('Listo', 'El saldo de créditos quedó actualizado.');
    } catch (err) {
      Alert.alert('No se pudo otorgar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsGranting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>
        Busca un usuario por correo para ver y ajustar sus créditos de creación de grupo.
      </Text>

      <Card style={styles.section}>
        <TextField
          label="Correo del usuario"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Button label="Buscar" onPress={handleSearch} loading={isSearching} />
      </Card>

      {isSearching ? (
        <ActivityIndicator color={colors.primary} />
      ) : foundUser ? (
        <Card style={styles.section}>
          <Text style={styles.userName}>{foundUser.fullName}</Text>
          <Text style={styles.creditsValue}>Créditos actuales: {foundUser.credits}</Text>
          <TextField
            label="Cantidad a otorgar (negativo para quitar)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="numbers-and-punctuation"
          />
          <Button label="Otorgar créditos" onPress={handleGrant} loading={isGranting} />
        </Card>
      ) : null}

      <Button label="Volver" variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.lg },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  section: { gap: spacing.md },
  userName: { ...typography.heading, fontSize: 16, color: colors.text },
  creditsValue: { color: colors.text, fontWeight: '600' },
});
