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

/**
 * The actual player — split out from KothVideoModal below and only ever rendered while `visible`,
 * so it genuinely mounts and unmounts with the modal instead of living forever. A first attempt at
 * this fix only reset `signedUrl` back to null on close, pausing playback and dropping the loaded
 * source — but kept the `useVideoPlayer` object itself alive for as long as KothVideoModal stayed
 * mounted, which (this screen is a tab, which never unmounts) meant for the rest of the app
 * session after the first video anyone ever opened here. Two separate crash logs, on a build
 * already running that fix, still showed a background thread deep in AVPlayer/remote-player
 * creation (MediaToolbox's FigPlayerRemoteCreateWithOptions) hours into a background app launch —
 * proving the player object itself, not just its source, was the thing that needed to actually go
 * away. Unmounting this component is what expo-video's own cleanup is built around; emptying its
 * source while it stays mounted forever is not a substitute for that.
 */
function KothVideoPlayer({ videoPath }: { videoPath: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired'>('loading');
  const player = useVideoPlayer(signedUrl ?? null);

  useEffect(() => {
    getSignedUrl('koth-videos', videoPath)
      .then((url) => {
        setSignedUrl(url);
        setStatus('ready');
      })
      .catch(() => setStatus('expired'));
  }, [videoPath]);

  useEffect(() => {
    if (status === 'ready') player.play();
  }, [status, player]);

  return (
    <>
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
        <VideoView key={signedUrl} player={player} style={styles.videoArea} nativeControls fullscreenOptions={{ enable: true }} />
      ) : null}
    </>
  );
}

/** Full-screen video viewer for a KOTH claim — resolves its own signed URL on open, mirrors CheckinPhotoModal. */
export function KothVideoModal({ visible, videoPath, onClose }: KothVideoModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {visible && videoPath ? <KothVideoPlayer key={videoPath} videoPath={videoPath} /> : null}
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
