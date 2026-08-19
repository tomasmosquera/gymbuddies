import { Component, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { colors, spacing, typography } from '@/constants/theme';

export interface MapPickedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}

interface LocationMapPickerModalProps {
  visible: boolean;
  /** Where to center the map — the admin's own locked location if available, otherwise a default. */
  initialLocation: MapPickedLocation | null;
  onPick: (location: MapPickedLocation) => void;
  onClose: () => void;
}

// Bogotá — only used when we have no better guess for where to center the map.
const DEFAULT_CENTER = { latitude: 4.711, longitude: -74.0721 };

type MapsModule = typeof import('react-native-maps');

/**
 * react-native-maps is a real native module — it only works once it's
 * actually compiled into the app binary via a native build. Until that
 * build ships, this stays installed as a JS dependency but unusable on
 * whatever's already running on devices, so it must never be a static
 * top-level `import` (same reasoning as the HealthKit Nitro module, see
 * src/lib/health/appleHealth.ts) — only a lazy `require()`, wrapped in a
 * try/catch, called the moment the admin actually opens the map.
 */
function loadMaps(): MapsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see doc comment above
    return require('react-native-maps');
  } catch {
    return null;
  }
}

/** Catches whatever loadMaps()'s try/catch didn't — e.g. a throw during MapView's own mount, not just its require(). */
class MapErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // Nothing to log server-side for this — it's an expected state until the next native build ships.
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function MapUnavailableFallback({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.unavailable}>
      <Ionicons name="map-outline" size={40} color={colors.textMuted} />
      <Text style={styles.unavailableTitle}>El mapa todavía no está disponible</Text>
      <Text style={styles.unavailableText}>
        Esta versión de la app no lo tiene activado todavía. Mientras tanto, usa &ldquo;Mi ubicación actual&rdquo;.
      </Text>
      <Button label="Cerrar" variant="secondary" onPress={onClose} />
    </View>
  );
}

function MapPickerContent({
  maps,
  initialLocation,
  onPick,
}: {
  maps: MapsModule;
  initialLocation: MapPickedLocation | null;
  onPick: (location: MapPickedLocation) => void;
}) {
  const MapView = maps.default;
  const { Marker } = maps;
  const center = initialLocation ?? DEFAULT_CENTER;
  const [picked, setPicked] = useState<MapPickedLocation | null>(initialLocation);

  return (
    <>
      <MapView
        style={styles.map}
        initialRegion={{ ...center, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        onPress={(e) =>
          setPicked({ latitude: e.nativeEvent.coordinate.latitude, longitude: e.nativeEvent.coordinate.longitude, accuracyMeters: null })
        }
      >
        {picked ? (
          <Marker
            coordinate={picked}
            draggable
            onDragEnd={(e) =>
              setPicked({
                latitude: e.nativeEvent.coordinate.latitude,
                longitude: e.nativeEvent.coordinate.longitude,
                accuracyMeters: null,
              })
            }
          />
        ) : null}
      </MapView>
      <View style={styles.footer}>
        <Text style={styles.footerHint}>
          {picked ? 'Toca otro punto o arrastra el marcador para ajustar.' : 'Toca el mapa para elegir un punto.'}
        </Text>
        <Button label="Confirmar ubicación" onPress={() => picked && onPick(picked)} disabled={!picked} />
      </View>
    </>
  );
}

export function LocationMapPickerModal({ visible, initialLocation, onPick, onClose }: LocationMapPickerModalProps) {
  const maps = useMemo(() => (visible ? loadMaps() : null), [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Elegir ubicación en el mapa</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </Pressable>
        </View>
        {maps ? (
          <MapErrorBoundary fallback={<MapUnavailableFallback onClose={onClose} />}>
            <MapPickerContent maps={maps} initialLocation={initialLocation} onPick={onPick} />
          </MapErrorBoundary>
        ) : (
          <MapUnavailableFallback onClose={onClose} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.heading, fontSize: 17, color: colors.text },
  map: { flex: 1 },
  footer: { padding: spacing.lg, gap: spacing.sm },
  footerHint: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  unavailableTitle: { ...typography.heading, fontSize: 16, color: colors.text },
  unavailableText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
