import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getSignedUrl } from '@/lib/supabase/storage';
import { colors, radii, spacing } from '@/constants/theme';

interface KothVideoModalProps {
  visible: boolean;
  videoPath: string | null;
  onClose: () => void;
}

/** Full-screen video viewer for a KOTH claim — resolves its own signed URL on open, mirrors CheckinPhotoModal. */
export function KothVideoModal({ visible, videoPath, onClose }: KothVideoModalProps) {
  const insets = useSafeAreaInsets();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');
  const player = useVideoPlayer(signedUrl ?? null);

  useEffect(() => {
    if (!visible || !videoPath) return;
    setStatus('loading');
    setSignedUrl(null);
    getSignedUrl('koth-videos', videoPath)
      .then((url) => {
        setSignedUrl(url);
        setStatus('ready');
      })
      .catch(() => setStatus('expired'));
  }, [visible, videoPath]);

  useEffect(() => {
    if (visible && status === 'ready') {
      player.play();
    } else {
      player.pause();
    }
  }, [visible, status, player]);

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
            <Text style={styles.expiredText}>Este video ya no está disponible.</Text>
          </View>
        ) : null}
        {status === 'ready' && signedUrl ? (
          <VideoView key={signedUrl} player={player} style={styles.videoArea} nativeControls allowsFullscreen />
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
  videoArea: { flex: 1 },
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
