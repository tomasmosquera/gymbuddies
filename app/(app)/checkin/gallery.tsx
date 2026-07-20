import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupWeekCheckins, type GroupCheckinWithProfile } from '@/hooks/useGroupWeekCheckins';
import { getSignedUrl } from '@/lib/supabase/storage';
import { formatBogotaDateTime, toBogotaDateString } from '@/lib/domain/dateUtils';
import { colors, radii, spacing, typography } from '@/constants/theme';

const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDayLabel(dateString: string, todayString: string): string {
  if (dateString === todayString) return 'Hoy';
  const [year, month, day] = dateString.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const isoIndex = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
  return `${WEEKDAY_NAMES[isoIndex]} ${day} de ${MONTH_NAMES[month - 1]}`;
}

function CheckinRow({ checkin, onPress }: { checkin: GroupCheckinWithProfile; onPress: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [locationText, setLocationText] = useState<string | null>(null);

  useEffect(() => {
    getSignedUrl('checkins', checkin.photo_path)
      .then(setSignedUrl)
      .catch(() => setSignedUrl(null));
  }, [checkin.photo_path]);

  useEffect(() => {
    Location.reverseGeocodeAsync({ latitude: checkin.latitude, longitude: checkin.longitude })
      .then((results) => {
        const place = results[0];
        setLocationText(place ? [place.street, place.city, place.region].filter(Boolean).join(', ') : null);
      })
      .catch(() => setLocationText(null));
  }, [checkin.latitude, checkin.longitude]);

  const coordsText = `${checkin.latitude.toFixed(5)}, ${checkin.longitude.toFixed(5)}`;

  return (
    <Pressable onPress={onPress}>
      <Card style={styles.row}>
        {signedUrl ? (
          <Image source={{ uri: signedUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={styles.name} numberOfLines={1}>
            {checkin.profile.full_name}
          </Text>
          <Text style={styles.meta}>{formatBogotaDateTime(new Date(checkin.captured_at))}</Text>
          <Text style={styles.meta} numberOfLines={2}>
            📍 {locationText ?? coordsText}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function CheckinGalleryScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { checkins, isLoading, refresh } = useGroupWeekCheckins(group?.id ?? null);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);

  const todayString = toBogotaDateString(new Date());

  const sections = useMemo(() => {
    const byDate = new Map<string, GroupCheckinWithProfile[]>();
    for (const c of checkins) {
      const list = byDate.get(c.checkin_date) ?? [];
      list.push(c);
      byDate.set(c.checkin_date, list);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1)) // most recent day first
      .map(([date, items]) => ({
        title: formatDayLabel(date, todayString),
        data: [...items].sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name)),
      }));
  }, [checkins, todayString]);

  if (groupLoading || isLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <SectionList
        contentContainerStyle={styles.container}
        sections={sections}
        keyExtractor={(item) => item.id}
        onRefresh={refresh}
        refreshing={false}
        ListHeaderComponent={<Text style={styles.subtitle}>Check-ins de todo el grupo esta semana.</Text>}
        ListEmptyComponent={
          <EmptyState title="Sin fotos todavía" description="Nadie del grupo ha hecho check-in esta semana." />
        }
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <CheckinRow checkin={item} onPress={() => setViewingPhotoPath(item.photo_path)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
      <CheckinPhotoModal
        visible={viewingPhotoPath !== null}
        photoPath={viewingPhotoPath}
        onClose={() => setViewingPhotoPath(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  sectionHeader: {
    ...typography.heading,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  photo: { width: 90, height: 120, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, justifyContent: 'center', gap: 2 },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  meta: { color: colors.textMuted, fontSize: 13 },
});
