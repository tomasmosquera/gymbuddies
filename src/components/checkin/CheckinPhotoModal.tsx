import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSignedUrl } from '@/lib/supabase/storage';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { colors, radii, spacing } from '@/constants/theme';

interface CheckinPhotoModalProps {
  visible: boolean;
  photoPath: string | null;
  onClose: () => void;
}

export function CheckinPhotoModal({ visible, photoPath, onClose }: CheckinPhotoModalProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible || !photoPath) return;
    setStatus('loading');
    setSignedUrl(null);
    getSignedUrl('checkins', photoPath)
      .then((url) => {
        setSignedUrl(url);
        setStatus('ready');
      })
      .catch(() => setStatus('expired'));
  }, [visible, photoPath]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        {status === 'expired' ? (
          <View style={styles.center}>
            <Text style={styles.expiredText}>
              Esta foto ya no está disponible — las fotos solo se guardan por 1 semana.
            </Text>
          </View>
        ) : null}
        {status === 'ready' && signedUrl ? (
          <ZoomableImage key={signedUrl} uri={signedUrl} style={styles.imageArea} onDismiss={onClose} />
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={16}
          style={[styles.closeButton, { top: insets.top + spacing.md }]}
        >
          <Text style={styles.closeButtonText}>Cerrar ✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  imageArea: { flex: 1 },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 10,
    elevation: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: { color: colors.text, fontWeight: '700' },
  expiredText: { color: colors.text, textAlign: 'center', padding: spacing.lg },
});
