import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TextField } from '@/components/ui/TextField';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroupMembers';
import { supabase } from '@/lib/supabase/client';
import { toBogotaDateString } from '@/lib/domain/dateUtils';
import type { AttendanceOverride } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

function MemberPicker({
  members,
  selectedId,
  onSelect,
}: {
  members: GroupMemberWithProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.memberList}>
      {members.map((m) => {
        const isSelected = m.user_id === selectedId;
        return (
          <Pressable
            key={m.id}
            onPress={() => onSelect(m.user_id)}
            style={[styles.memberChip, isSelected && styles.memberChipSelected]}
          >
            <Text style={[styles.memberChipText, isSelected && styles.memberChipTextSelected]}>
              {m.profile.full_name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function AdminAttendanceScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { members, isLoading: membersLoading } = useGroupMembers(group?.id ?? null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [date, setDate] = useState(toBogotaDateString(new Date()));
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [overrides, setOverrides] = useState<AttendanceOverride[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);

  const refreshOverrides = useCallback(async () => {
    if (!group || !selectedUserId) {
      setOverrides([]);
      return;
    }
    setOverridesLoading(true);
    const { data, error } = await supabase
      .from('attendance_overrides')
      .select('*')
      .eq('group_id', group.id)
      .eq('user_id', selectedUserId)
      .order('override_date', { ascending: false });
    if (!error && data) setOverrides(data);
    setOverridesLoading(false);
  }, [group, selectedUserId]);

  useEffect(() => {
    refreshOverrides();
  }, [refreshOverrides]);

  const selectedMember = members.find((m) => m.user_id === selectedUserId) ?? null;

  const handleSet = async (status: 'valid' | 'failed') => {
    if (!group || !selectedUserId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Fecha inválida', 'Usa el formato YYYY-MM-DD.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('set_attendance_override', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_date: date,
        p_status: status,
        p_note: note || null,
      });
      if (error) throw new Error(error.message);
      setNote('');
      await refreshOverrides();
      Alert.alert('Listo', `Día marcado como ${status === 'valid' ? 'válido' : 'fallado'}.`);
    } catch (err) {
      Alert.alert('No se pudo asignar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = (overrideDate: string) => {
    Alert.alert('Quitar asignación', `¿Quitar la asignación del ${overrideDate}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          if (!group || !selectedUserId) return;
          try {
            const { error } = await supabase.rpc('clear_attendance_override', {
              p_group_id: group.id,
              p_user_id: selectedUserId,
              p_date: overrideDate,
            });
            if (error) throw new Error(error.message);
            await refreshOverrides();
          } catch (err) {
            Alert.alert('No se pudo quitar', err instanceof Error ? err.message : 'Intenta de nuevo');
          }
        },
      },
    ]);
  };

  if (groupLoading || membersLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>
        Asigna un día como válido o fallado para cualquier jugador, sin necesidad de votación.
      </Text>

      <Text style={styles.sectionLabel}>Jugador</Text>
      <MemberPicker members={members} selectedId={selectedUserId} onSelect={setSelectedUserId} />

      {selectedMember ? (
        <>
          <TextField
            label="Fecha (YYYY-MM-DD)"
            value={date}
            onChangeText={setDate}
            placeholder={toBogotaDateString(new Date())}
          />
          <TextField label="Nota (opcional)" value={note} onChangeText={setNote} multiline />

          <View style={styles.actionButtons}>
            <Button label="Marcar válido" onPress={() => handleSet('valid')} loading={isSubmitting} />
            <Button label="Marcar fallado" variant="danger" onPress={() => handleSet('failed')} loading={isSubmitting} />
          </View>

          <Text style={styles.sectionLabel}>Asignaciones de {selectedMember.profile.full_name}</Text>
          {overridesLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : overrides.length === 0 ? (
            <Text style={styles.emptyText}>Sin asignaciones todavía.</Text>
          ) : (
            overrides.map((o) => (
              <Card key={o.id} style={styles.overrideRow}>
                <View>
                  <Text style={styles.overrideDate}>{o.override_date}</Text>
                  {o.note ? <Text style={styles.overrideNote}>{o.note}</Text> : null}
                </View>
                <View style={styles.overrideRight}>
                  <Badge
                    label={o.status === 'valid' ? 'Válido' : 'Fallado'}
                    tone={o.status === 'valid' ? 'success' : 'danger'}
                  />
                  <Button label="Quitar" variant="secondary" onPress={() => handleClear(o.override_date)} />
                </View>
              </Card>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  sectionLabel: { ...typography.heading, fontSize: 15, color: colors.text, marginTop: spacing.sm },
  memberList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  memberChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  memberChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  memberChipText: { color: colors.textMuted, fontWeight: '600' },
  memberChipTextSelected: { color: colors.primaryText },
  actionButtons: { flexDirection: 'row', gap: spacing.sm },
  emptyText: { color: colors.textMuted },
  overrideRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  overrideDate: { color: colors.text, fontWeight: '600' },
  overrideNote: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  overrideRight: { alignItems: 'flex-end', gap: spacing.xs },
});
