import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>Cerrar ✕</Text>
        </Pressable>
        {imageUrl ? <ZoomableImage key={imageUrl} uri={imageUrl} style={styles.imageArea} /> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  closeButton: {
    alignSelf: 'flex-end',
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  closeButtonText: { color: colors.text, fontWeight: '600' },
  imageArea: { flex: 1 },
});
