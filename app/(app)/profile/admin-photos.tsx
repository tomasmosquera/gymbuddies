import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupWeekCheckins, type GroupCheckinWithProfile } from '@/hooks/useGroupWeekCheckins';
import { supabase } from '@/lib/supabase/client';
import { getSignedUrl } from '@/lib/supabase/storage';
import { formatBogotaDateTime } from '@/lib/domain/dateUtils';
import { colors, radii, spacing, typography } from '@/constants/theme';

function CheckinModerationRow({ checkin, onDeleted }: { checkin: GroupCheckinWithProfile; onDeleted: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    getSignedUrl('checkins', checkin.photo_path)
      .then(setSignedUrl)
      .catch(() => setSignedUrl(null));
  }, [checkin.photo_path]);

  const confirmDelete = () => {
    Alert.alert(
      'Borrar check-in',
      `¿Borrar el check-in de ${checkin.profile.full_name} del ${formatBogotaDateTime(new Date(checkin.captured_at))}? Ese día deja de contar como entrenado.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: handleDelete },
      ]
    );
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_delete_checkin', { p_checkin_id: checkin.id });
      if (error) throw new Error(error.message);
      onDeleted();
    } catch (err) {
      Alert.alert('No se pudo borrar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
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
        <Button label="Borrar check-in" variant="danger" onPress={confirmDelete} loading={isDeleting} />
      </View>
    </Card>
  );
}

export default function AdminPhotosScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { checkins, isLoading, refresh } = useGroupWeekCheckins(group?.id ?? null);

  if (groupLoading || isLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const sorted = [...checkins].sort((a, b) => (a.checkin_date < b.checkin_date ? 1 : -1));

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={sorted}
      keyExtractor={(item) => item.id}
      onRefresh={refresh}
      refreshing={false}
      ListHeaderComponent={
        <Text style={styles.subtitle}>
          Check-ins de todo el grupo esta semana. Borrar uno quita el crédito de ese día.
        </Text>
      }
      ListEmptyComponent={
        <EmptyState title="Sin check-ins todavía" description="Nadie del grupo ha hecho check-in esta semana." />
      }
      renderItem={({ item }) => <CheckinModerationRow checkin={item} onDeleted={refresh} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  photo: { width: 90, height: 120, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, justifyContent: 'center', gap: spacing.xs },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  meta: { color: colors.textMuted, fontSize: 13 },
});
