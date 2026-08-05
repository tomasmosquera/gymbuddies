import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ZoomableImage } from './ZoomableImage';
import { colors, radii, spacing } from '@/constants/theme';

interface ZoomableImageModalProps {
  visible: boolean;
  /** Already-resolved (e.g. a signed URL) — this component does no fetching of its own. Null while still loading. */
  imageUrl: string | null;
  onClose: () => void;
}

/** Full-screen zoomable viewer for an already-loaded image URL — the excuse-proof-photo counterpart to CheckinPhotoModal (which additionally resolves a storage path itself). */
export function ZoomableImageModal({ visible, imageUrl, onClose }: ZoomableImageModalProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {imageUrl ? <ZoomableImage key={imageUrl} uri={imageUrl} style={styles.imageArea} onDismiss={onClose} /> : null}
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
});
