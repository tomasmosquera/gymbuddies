import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { getSignedUrl } from '@/lib/supabase/storage';
import type { ExcuseRequest } from '@/lib/supabase/types';
import { colors, radii, spacing } from '@/constants/theme';

interface PendingRequest extends ExcuseRequest {
  member_name: string;
}

const TYPE_LABELS: Record<'travel' | 'medical', string> = {
  travel: 'Viaje',
  medical: 'Médica',
};

/** Every calendar date string between start and end, inclusive. */
function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function PendingRequestRow({ request, onDecided }: { request: PendingRequest; onDecided: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const allDates = datesInRange(request.requested_start_date, request.requested_end_date);
  const [selectedDates, setSelectedDates] = useState<string[]>(allDates);
  const [isDeciding, setIsDeciding] = useState(false);

  useEffect(() => {
    if (request.proof_path) {
      getSignedUrl('excuse-proofs', request.proof_path).then(setSignedUrl).catch(() => setSignedUrl(null));
    }
  }, [request.proof_path]);

  const toggleDate = (date: string) => {
    setSelectedDates((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));
  };

  const approve = async () => {
    if (selectedDates.length === 0) {
      Alert.alert('Selecciona al menos un día', 'Elige qué días de la solicitud quedan excusados.');
      return;
    }
    setIsDeciding(true);
    try {
      const { error } = await supabase.rpc('approve_excuse_request', {
        p_request_id: request.id,
        p_excused_dates: selectedDates,
      });
      if (error) throw new Error(error.message);
      onDecided();
    } catch (err) {
      Alert.alert('No se pudo aprobar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeciding(false);
    }
  };

  const reject = async () => {
    setIsDeciding(true);
    try {
      const { error } = await supabase.rpc('reject_excuse_request', { p_request_id: request.id });
      if (error) throw new Error(error.message);
      onDecided();
    } catch (err) {
      Alert.alert('No se pudo rechazar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeciding(false);
    }
  };

  return (
    <Card style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{request.member_name}</Text>
        <Badge label={TYPE_LABELS[request.excuse_type as 'travel' | 'medical']} />
      </View>
      <Text style={styles.rowSubtitle}>
        {request.requested_start_date} a {request.requested_end_date}
      </Text>
      {request.reason ? <Text style={styles.reason}>{request.reason}</Text> : null}
      {signedUrl ? <Image source={{ uri: signedUrl }} style={styles.proof} /> : null}

      <Text style={styles.datesLabel}>Días a excusar:</Text>
      <View style={styles.datesList}>
        {allDates.map((date) => {
          const isSelected = selectedDates.includes(date);
          return (
            <Pressable
              key={date}
              onPress={() => toggleDate(date)}
              style={[styles.dateChip, isSelected && styles.dateChipSelected]}
            >
              <Text style={[styles.dateChipText, isSelected && styles.dateChipTextSelected]}>{date}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Button label="Aprobar" onPress={approve} loading={isDeciding} />
        <Button label="Rechazar" variant="danger" onPress={reject} loading={isDeciding} />
      </View>
    </Card>
  );
}

export default function ExcuseAdminScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!group) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('excuse_requests')
      .select('*, profile:profiles(full_name)')
      .eq('group_id', group.id)
      .eq('status', 'pending')
      .in('excuse_type', ['travel', 'medical'])
      .order('created_at', { ascending: true });

    if (!error && data) {
      setRequests(
        (data as unknown as (ExcuseRequest & { profile: { full_name: string } })[]).map((r) => ({
          ...r,
          member_name: r.profile.full_name,
        }))
      );
    }
    setIsLoading(false);
  }, [group]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (groupLoading || isLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={requests}
      keyExtractor={(item) => item.id}
      onRefresh={refresh}
      refreshing={false}
      ListEmptyComponent={<EmptyState title="Sin pendientes" description="No hay excusas de viaje o médicas por revisar." />}
      renderItem={({ item }) => <PendingRequestRow request={item} onDecided={refresh} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  row: { gap: spacing.sm },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  rowSubtitle: { color: colors.textMuted },
  reason: { color: colors.text },
  proof: { width: '100%', height: 220, borderRadius: radii.md },
  datesLabel: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  datesList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  dateChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  dateChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateChipText: { color: colors.textMuted, fontSize: 12 },
  dateChipTextSelected: { color: colors.primaryText, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
