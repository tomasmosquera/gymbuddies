import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/lib/supabase/client';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { joinGroupSchema } from '@/lib/validation/schemas';
import { colors, radii, spacing, typography } from '@/constants/theme';

/** Accepts either a bare code or a "gymbuddies://join-group?code=XXX" deep link (from a QR or WhatsApp share). */
function extractInviteCode(scanned: string): string {
  try {
    const url = new URL(scanned);
    return url.searchParams.get('code') ?? scanned;
  } catch {
    return scanned;
  }
}

export default function JoinGroupScreen() {
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const { code: deepLinkCode } = useLocalSearchParams<{ code?: string }>();
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const hasAutoSubmittedRef = useRef(false);

  const handleSubmit = async (codeOverride?: string) => {
    const result = joinGroupSchema.safeParse({ inviteCode: codeOverride ?? inviteCode });
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

  // A code arriving via deep link (QR scanned by the system camera, or a
  // WhatsApp link) means the user already decided to join — pre-fill and
  // submit right away instead of making them retype/re-tap anything.
  useEffect(() => {
    if (deepLinkCode && !hasAutoSubmittedRef.current) {
      hasAutoSubmittedRef.current = true;
      setInviteCode(deepLinkCode);
      handleSubmit(deepLinkCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkCode]);

  const handleScanned = (data: string) => {
    setIsScanning(false);
    const code = extractInviteCode(data);
    setInviteCode(code);
    handleSubmit(code);
  };

  const handleOpenScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setIsScanning(true);
  };

  if (isScanning) {
    return (
      <View style={styles.flex}>
        <CameraView
          style={styles.flex}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => handleScanned(data)}
        />
        <Pressable style={styles.cancelScanButton} onPress={() => setIsScanning(false)}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
      </View>
    );
  }

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
          <Button label="Unirme al grupo" onPress={() => handleSubmit()} loading={isSubmitting} />
          <Button label="Escanear código QR" variant="secondary" onPress={handleOpenScanner} />
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
  cancelScanButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
