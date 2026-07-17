import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { getSignedUrl } from '@/lib/supabase/storage';
import { colors, radii, spacing } from '@/constants/theme';

interface CheckinPhotoModalProps {
  visible: boolean;
  photoPath: string | null;
  onClose: () => void;
}

export function CheckinPhotoModal({ visible, photoPath, onClose }: CheckinPhotoModalProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');

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
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.content}>
          {status === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
          {status === 'expired' ? (
            <Text style={styles.expiredText}>
              Esta foto ya no está disponible — las fotos solo se guardan por 1 semana.
            </Text>
          ) : null}
          {status === 'ready' && signedUrl ? <Image source={{ uri: signedUrl }} style={styles.photo} /> : null}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  content: {
    width: '100%',
    maxHeight: '80%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radii.lg },
  expiredText: { color: colors.text, textAlign: 'center', padding: spacing.lg },
});
