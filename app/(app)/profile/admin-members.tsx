import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TextField } from '@/components/ui/TextField';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroupMembers';
import { supabase } from '@/lib/supabase/client';
import { toBogotaDateString } from '@/lib/domain/dateUtils';
import type { AttendanceOverride, WalletTransaction } from '@/lib/supabase/types';
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

function InlineDatePicker({
  value,
  onChange,
}: {
  value: Date;
  onChange: (date: Date) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    setIsOpen(false);
    if (event.type === 'set' && date) onChange(date);
  };

  // iOS's "compact" style is already a self-contained tap-to-open pill —
  // wrapping it in our own reveal button would just add a redundant tap.
  // It renders transparent by default, so give it the same surface/border
  // as our secondary buttons to stand out against the dark background.
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.iosDatePickerWrapper}>
        <DateTimePicker
          value={value}
          mode="date"
          display="compact"
          themeVariant="dark"
          accentColor={colors.primary}
          maximumDate={new Date()}
          onChange={handleChange}
        />
      </View>
    );
  }

  // Android's picker opens as a modal dialog the instant it mounts, so it
  // has to stay unmounted until the button is pressed.
  return (
    <View style={styles.datePickerWrapper}>
      <Button
        label={`📅 ${value.toLocaleDateString('es-CO')}`}
        variant="secondary"
        onPress={() => setIsOpen(true)}
      />
      {isOpen ? <DateTimePicker value={value} mode="date" maximumDate={new Date()} onChange={handleChange} /> : null}
    </View>
  );
}

export default function AdminMembersScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { members, isLoading: membersLoading, refresh: refreshMembers } = useGroupMembers(group?.id ?? null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const selectedMember = members.find((m) => m.user_id === selectedUserId) ?? null;

  // --- Section 1: activation date ---
  const [activationDate, setActivationDate] = useState(new Date());
  const [isSavingActivation, setIsSavingActivation] = useState(false);

  // --- Section 2: attendance override ---
  const [attendanceDate, setAttendanceDate] = useState(new Date());
  const [attendanceNote, setAttendanceNote] = useState('');
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState(false);
  const [dayStatusLoading, setDayStatusLoading] = useState(false);
  const [hasCheckin, setHasCheckin] = useState(false);
  const [currentOverride, setCurrentOverride] = useState<AttendanceOverride | null>(null);

  // --- Section 3: balance ---
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceNote, setBalanceNote] = useState('');
  const [isSubmittingBalance, setIsSubmittingBalance] = useState(false);
  const [adjustments, setAdjustments] = useState<WalletTransaction[]>([]);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);

  // --- Section 4: remove ---
  const [isRemoving, setIsRemoving] = useState(false);

  // Reset every section's transient state whenever a different member is picked.
  useEffect(() => {
    setActivationDate(
      selectedMember ? new Date(selectedMember.activated_at ?? selectedMember.joined_at) : new Date()
    );
    setAttendanceDate(new Date());
    setAttendanceNote('');
    setBalanceAmount('');
    setBalanceNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  const refreshDayStatus = useCallback(async () => {
    if (!group || !selectedUserId) return;
    setDayStatusLoading(true);
    const dateString = toBogotaDateString(attendanceDate);
    const [{ data: checkinData }, { data: overrideData }] = await Promise.all([
      supabase
        .from('checkins')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', selectedUserId)
        .eq('checkin_date', dateString)
        .maybeSingle(),
      supabase
        .from('attendance_overrides')
        .select('*')
        .eq('group_id', group.id)
        .eq('user_id', selectedUserId)
        .eq('override_date', dateString)
        .maybeSingle(),
    ]);
    setHasCheckin(!!checkinData);
    setCurrentOverride(overrideData ?? null);
    setDayStatusLoading(false);
  }, [group, selectedUserId, attendanceDate]);

  useEffect(() => {
    refreshDayStatus();
  }, [refreshDayStatus]);

  const refreshAdjustments = useCallback(async () => {
    if (!group || !selectedUserId) {
      setAdjustments([]);
      return;
    }
    setAdjustmentsLoading(true);
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('group_id', group.id)
      .eq('user_id', selectedUserId)
      .eq('type', 'adjustment')
      .order('created_at', { ascending: false });
    if (!error && data) setAdjustments(data);
    setAdjustmentsLoading(false);
  }, [group, selectedUserId]);

  useEffect(() => {
    refreshAdjustments();
  }, [refreshAdjustments]);

  if (groupLoading || membersLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const handleSaveActivationDate = async () => {
    if (!selectedMember) return;
    setIsSavingActivation(true);
    try {
      const { error } = await supabase.rpc('admin_set_member_activation_date', {
        p_member_id: selectedMember.id,
        p_date: toBogotaDateString(activationDate),
      });
      if (error) throw new Error(error.message);
      await refreshMembers();
      Alert.alert('Listo', 'Se actualizó la fecha de entrada.');
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingActivation(false);
    }
  };

  const handleSetDayStatus = async (status: 'valid' | 'failed') => {
    if (!group || !selectedUserId) return;
    setIsSubmittingAttendance(true);
    try {
      const { error } = await supabase.rpc('set_attendance_override', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_date: toBogotaDateString(attendanceDate),
        p_status: status,
        p_note: attendanceNote || null,
      });
      if (error) throw new Error(error.message);
      setAttendanceNote('');
      await refreshDayStatus();
    } catch (err) {
      Alert.alert('No se pudo asignar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmittingAttendance(false);
    }
  };

  const handleClearDayStatus = async () => {
    if (!group || !selectedUserId) return;
    setIsSubmittingAttendance(true);
    try {
      const { error } = await supabase.rpc('clear_attendance_override', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_date: toBogotaDateString(attendanceDate),
      });
      if (error) throw new Error(error.message);
      await refreshDayStatus();
    } catch (err) {
      Alert.alert('No se pudo quitar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmittingAttendance(false);
    }
  };

  const handleAdjustBalance = async (sign: 1 | -1) => {
    if (!group || !selectedUserId) return;
    const numeric = Number(balanceAmount);
    if (!balanceAmount || Number.isNaN(numeric) || numeric <= 0) {
      Alert.alert('Monto inválido', 'Ingresa un monto mayor a 0.');
      return;
    }
    setIsSubmittingBalance(true);
    try {
      const { error } = await supabase.rpc('admin_adjust_balance', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_amount: numeric * sign,
        p_note: balanceNote || null,
      });
      if (error) throw new Error(error.message);
      setBalanceAmount('');
      setBalanceNote('');
      await Promise.all([refreshAdjustments(), refreshMembers()]);
      Alert.alert('Listo', `Saldo ${sign > 0 ? 'aumentado' : 'disminuido'} correctamente.`);
    } catch (err) {
      Alert.alert('No se pudo ajustar el saldo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmittingBalance(false);
    }
  };

  const confirmRemove = () => {
    if (!selectedMember) return;
    Alert.alert(
      'Sacar del grupo',
      `¿Sacar a ${selectedMember.profile.full_name} del grupo? No podrá volver a entrar con el código de invitación.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sacar', style: 'destructive', onPress: handleRemove },
      ]
    );
  };

  const handleRemove = async () => {
    if (!selectedMember) return;
    setIsRemoving(true);
    try {
      const { error } = await supabase.rpc('admin_remove_member', { p_member_id: selectedMember.id });
      if (error) throw new Error(error.message);
      setSelectedUserId(null);
      await refreshMembers();
      Alert.alert('Listo', 'El miembro fue sacado del grupo.');
    } catch (err) {
      Alert.alert('No se pudo sacar al miembro', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsRemoving(false);
    }
  };

  const dayStatusLabel = dayStatusLoading
    ? 'Revisando...'
    : currentOverride
      ? currentOverride.status === 'valid'
        ? 'Marcado válido por el admin'
        : 'Marcado fallado por el admin'
      : hasCheckin
        ? 'Día registrado (check-in)'
        : 'Sin registro';

  const dayStatusTone = currentOverride
    ? currentOverride.status === 'valid'
      ? 'success'
      : 'danger'
    : hasCheckin
      ? 'success'
      : 'neutral';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>Selecciona un jugador para administrarlo.</Text>
      <MemberPicker members={members} selectedId={selectedUserId} onSelect={setSelectedUserId} />

      {selectedMember ? (
        <>
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Fecha de entrada al grupo</Text>
            <Text style={styles.sectionHint}>
              Actual: {new Date(selectedMember.activated_at ?? selectedMember.joined_at).toLocaleDateString('es-CO')}
            </Text>
            <InlineDatePicker value={activationDate} onChange={setActivationDate} />
            <Button label="Guardar fecha" onPress={handleSaveActivationDate} loading={isSavingActivation} />
          </Card>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Asignar día válido/fallado</Text>
            <InlineDatePicker value={attendanceDate} onChange={setAttendanceDate} />
            <View style={styles.dayStatusRow}>
              <Text style={styles.sectionHint}>Estado actual:</Text>
              <Badge label={dayStatusLabel} tone={dayStatusTone} />
            </View>
            <TextField label="Nota (opcional)" value={attendanceNote} onChangeText={setAttendanceNote} multiline />
            <View style={styles.actionButtons}>
              <Button
                label="Marcar válido"
                onPress={() => handleSetDayStatus('valid')}
                loading={isSubmittingAttendance}
              />
              <Button
                label="Marcar fallado"
                variant="danger"
                onPress={() => handleSetDayStatus('failed')}
                loading={isSubmittingAttendance}
              />
            </View>
            {currentOverride ? (
              <Button
                label="Quitar asignación"
                variant="secondary"
                onPress={handleClearDayStatus}
                loading={isSubmittingAttendance}
              />
            ) : null}
          </Card>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Ajustar saldo</Text>
            <Text style={styles.balanceValue}>
              {group.currency} {selectedMember.balance.toLocaleString('es-CO')}
            </Text>
            <TextField
              label={`Monto (${group.currency})`}
              value={balanceAmount}
              onChangeText={setBalanceAmount}
              keyboardType="numeric"
              placeholder="0"
            />
            <TextField label="Nota (opcional)" value={balanceNote} onChangeText={setBalanceNote} multiline />
            <View style={styles.actionButtons}>
              <Button label="Sumar al saldo" onPress={() => handleAdjustBalance(1)} loading={isSubmittingBalance} />
              <Button
                label="Restar del saldo"
                variant="danger"
                onPress={() => handleAdjustBalance(-1)}
                loading={isSubmittingBalance}
              />
            </View>
            {adjustmentsLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : adjustments.length > 0 ? (
              <View style={styles.adjustmentsList}>
                <Text style={styles.sectionHint}>Ajustes anteriores</Text>
                {adjustments.map((tx) => (
                  <View key={tx.id} style={styles.adjustmentRow}>
                    <Text style={[styles.adjustmentAmount, tx.amount < 0 && styles.adjustmentAmountNegative]}>
                      {tx.amount > 0 ? '+' : ''}
                      {tx.amount.toLocaleString('es-CO')}
                    </Text>
                    <Text style={styles.adjustmentDate}>{new Date(tx.created_at).toLocaleDateString('es-CO')}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>

          {selectedMember.role !== 'admin' ? (
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Sacar del grupo</Text>
              <Button label="Sacar del grupo" variant="danger" onPress={confirmRemove} loading={isRemoving} />
            </Card>
          ) : null}
        </>
      ) : null}

      <Button label="Volver" variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
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
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.heading, fontSize: 15, color: colors.text },
  sectionHint: { color: colors.textMuted, fontSize: 13 },
  datePickerWrapper: { gap: spacing.xs },
  iosDatePickerWrapper: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  dayStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionButtons: { flexDirection: 'row', gap: spacing.sm },
  balanceValue: { ...typography.title, color: colors.text },
  adjustmentsList: { gap: spacing.xs, marginTop: spacing.xs },
  adjustmentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adjustmentAmount: { color: colors.success, fontWeight: '700' },
  adjustmentAmountNegative: { color: colors.danger },
  adjustmentDate: { color: colors.textMuted, fontSize: 12 },
});
