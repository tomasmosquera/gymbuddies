import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/lib/supabase/client';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { joinGroupSchema } from '@/lib/validation/schemas';
import { colors, spacing, typography } from '@/constants/theme';

export default function JoinGroupScreen() {
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const result = joinGroupSchema.safeParse({ inviteCode });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('join_group', {
        p_invite_code: result.data.inviteCode,
      });
      if (rpcError || !data) throw new Error(rpcError?.message ?? 'No se pudo unir al grupo');
      setActiveGroupId(data.group_id);
      router.replace('/deposit');
    } catch (err) {
      Alert.alert('No se pudo unir al grupo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>Pídele a tu amigo el código de invitación del grupo.</Text>

        <View style={styles.form}>
          <TextField
            label="Código de invitación"
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="characters"
            autoCorrect={false}
            error={error}
          />
          <Button label="Unirme al grupo" onPress={handleSubmit} loading={isSubmitting} />
        </View>

        <Link href="/create-group" style={styles.link}>
          <Text style={styles.linkText}>Prefiero crear un grupo nuevo</Text>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.lg },
  subtitle: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  form: { gap: spacing.md },
  link: { alignSelf: 'center', marginTop: spacing.md },
  linkText: { color: colors.primary, fontWeight: '600' },
});
