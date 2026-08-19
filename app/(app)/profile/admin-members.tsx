import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TextField } from '@/components/ui/TextField';
import { InlineDatePicker } from '@/components/ui/InlineDatePicker';
import { InlineTimePicker } from '@/components/ui/InlineTimePicker';
import { LocationMapPickerModal, type MapPickedLocation } from '@/components/ui/LocationMapPickerModal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroupMembers';
import { useMemberCheckinLocations, type MemberCheckinLocation } from '@/hooks/useMemberCheckinLocations';
import { useLocationLock } from '@/hooks/useLocationLock';
import { supabase } from '@/lib/supabase/client';
import { checkinPhotoPath, checkoutPhotoPath, uploadImage } from '@/lib/supabase/storage';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import type { AttendanceOverride, ExcuseType, WalletTransaction } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

const YES_NO_OPTIONS: { key: 'yes' | 'no'; label: string }[] = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Sí' },
];

const EXCUSE_TYPE_OPTIONS: { key: 'medical' | 'travel'; label: string }[] = [
  { key: 'medical', label: 'Médica' },
  { key: 'travel', label: 'Viaje' },
];

const EXCUSE_TYPE_LABELS: Record<ExcuseType, string> = {
  medical: 'médica',
  travel: 'viaje',
  other: 'otro motivo',
};

/** A location chosen for the evidence flow — from the member's own history, the admin's current GPS fix, or a tap on the map. Only `label` differs by source; the RPC only cares about the coordinates. */
interface PickedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  label: string;
}

function isSameLocation(a: PickedLocation | null, b: { latitude: number; longitude: number }): boolean {
  return a?.latitude === b.latitude && a?.longitude === b.longitude;
}

function PreviousLocationPicker({
  locations,
  isLoading,
  selected,
  onSelect,
}: {
  locations: MemberCheckinLocation[];
  isLoading: boolean;
  selected: PickedLocation | null;
  onSelect: (location: PickedLocation) => void;
}) {
  if (isLoading) return <ActivityIndicator color={colors.primary} />;
  if (locations.length === 0) {
    return <Text style={styles.sectionHint}>Este jugador todavía no tiene check-ins con ubicación para reusar.</Text>;
  }
  return (
    <View style={styles.locationList}>
      {locations.map((loc) => {
        const isSelected = isSameLocation(selected, loc);
        return (
          <Pressable
            key={`${loc.latitude},${loc.longitude}`}
            onPress={() =>
              onSelect({
                latitude: loc.latitude,
                longitude: loc.longitude,
                accuracyMeters: loc.accuracyMeters,
                label: `Ubicación usada el ${new Date(`${loc.lastUsedDate}T00:00:00`).toLocaleDateString('es-CO')}`,
              })
            }
            style={[styles.locationRow, isSelected && styles.locationRowSelected]}
          >
            <Text style={[styles.locationRowText, isSelected && styles.locationRowTextSelected]}>
              Ubicación usada el {new Date(`${loc.lastUsedDate}T00:00:00`).toLocaleDateString('es-CO')}
            </Text>
            {isSelected ? <Ionicons name="checkmark" size={18} color={colors.primaryText} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function MemberPicker({
  members,
  selectedId,
  onSelect,
}: {
  members: GroupMemberWithProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sortedMembers = [...members].sort((a, b) =>
    a.profile.full_name.localeCompare(b.profile.full_name, 'es', { sensitivity: 'base' })
  );
  return (
    <View style={styles.memberList}>
      {sortedMembers.map((m) => {
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

export default function AdminMembersScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { members, isLoading: membersLoading, refresh: refreshMembers } = useGroupMembers(group?.id ?? null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const selectedMember = members.find((m) => m.user_id === selectedUserId) ?? null;

  // --- Section 1: activation date ---
  const [activationDate, setActivationDate] = useState(new Date());
  const [isSavingActivation, setIsSavingActivation] = useState(false);

  // --- Section 1b: penalty start date ---
  const [penaltyStartDate, setPenaltyStartDate] = useState(new Date());
  const [isSavingPenaltyStart, setIsSavingPenaltyStart] = useState(false);

  // --- Section 2: attendance override ---
  const [attendanceDate, setAttendanceDate] = useState(new Date());
  const [attendanceNote, setAttendanceNote] = useState('');
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState(false);
  const [dayStatusLoading, setDayStatusLoading] = useState(false);
  const [hasCheckin, setHasCheckin] = useState(false);
  const [currentOverride, setCurrentOverride] = useState<AttendanceOverride | null>(null);
  const [excusedType, setExcusedType] = useState<ExcuseType | null>(null);
  const [markExcuseType, setMarkExcuseType] = useState<'medical' | 'travel'>('medical');
  const [isMarkingExcused, setIsMarkingExcused] = useState(false);

  // --- Section 2b: attach evidence when marking a day valid ---
  const [withEvidence, setWithEvidence] = useState<'yes' | 'no'>('no');
  const [initialPhotoUri, setInitialPhotoUri] = useState<string | null>(null);
  const [sameFinalPhoto, setSameFinalPhoto] = useState<'yes' | 'no'>('yes');
  const [finalPhotoUri, setFinalPhotoUri] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<PickedLocation | null>(null);
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);
  const [withDuration, setWithDuration] = useState<'yes' | 'no'>('no');
  const [evidenceStartTime, setEvidenceStartTime] = useState(new Date());
  const [evidenceEndTime, setEvidenceEndTime] = useState(new Date());
  const [evidenceCalories, setEvidenceCalories] = useState('');
  const [isSavingEvidence, setIsSavingEvidence] = useState(false);
  const { locations: memberLocations, isLoading: locationsLoading } = useMemberCheckinLocations(
    group?.id ?? null,
    selectedUserId
  );
  const adminLocationLock = useLocationLock();

  // --- Section 3: balance ---
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceNote, setBalanceNote] = useState('');
  const [isSubmittingBalance, setIsSubmittingBalance] = useState(false);
  const [adjustments, setAdjustments] = useState<WalletTransaction[]>([]);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);

  // --- Section: confirm initial deposit without a receipt photo ---
  const [depositAmount, setDepositAmount] = useState('');
  const [isConfirmingDeposit, setIsConfirmingDeposit] = useState(false);

  // --- Section 4: remove ---
  const [isRemoving, setIsRemoving] = useState(false);

  // --- Section 5: allow a removed member back in ---
  const [isAllowingRejoin, setIsAllowingRejoin] = useState(false);

  // Reset every section's transient state whenever a different member is picked.
  useEffect(() => {
    setActivationDate(
      selectedMember ? new Date(selectedMember.activated_at ?? selectedMember.joined_at) : new Date()
    );
    setPenaltyStartDate(
      selectedMember
        ? new Date(selectedMember.penalty_start_date ?? selectedMember.activated_at ?? selectedMember.joined_at)
        : new Date()
    );
    setAttendanceDate(new Date());
    setAttendanceNote('');
    setBalanceAmount('');
    setBalanceNote('');
    setDepositAmount(group ? String(group.initial_deposit_amount) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  const refreshDayStatus = useCallback(async () => {
    if (!group || !selectedUserId) return;
    setDayStatusLoading(true);
    const dateString = toZonedDateString(attendanceDate, group.timezone);
    const [{ data: checkinData }, { data: overrideData }, { data: excusedData }] = await Promise.all([
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
      supabase
        .from('excuse_dates')
        .select('*, request:excuse_requests!excuse_request_id(excuse_type)')
        .eq('group_id', group.id)
        .eq('user_id', selectedUserId)
        .eq('excused_date', dateString)
        .maybeSingle(),
    ]);
    setHasCheckin(!!checkinData);
    setCurrentOverride(overrideData ?? null);
    setExcusedType(
      (excusedData as unknown as { request: { excuse_type: ExcuseType } | null } | null)?.request?.excuse_type ?? null
    );
    setDayStatusLoading(false);
  }, [group, selectedUserId, attendanceDate]);

  useEffect(() => {
    refreshDayStatus();
  }, [refreshDayStatus]);

  // Evidence fields are per-day — a stale photo/location pick from a
  // previously viewed date must never silently ride along to a new one.
  useEffect(() => {
    setWithEvidence('no');
    setInitialPhotoUri(null);
    setSameFinalPhoto('yes');
    setFinalPhotoUri(null);
    setSelectedLocation(null);
    setWithDuration('no');
    setEvidenceStartTime(new Date());
    setEvidenceEndTime(new Date());
    setEvidenceCalories('');
    setMarkExcuseType('medical');
  }, [selectedUserId, attendanceDate]);

  // Reacts to the admin's own GPS fix, requested via "Usar mi ubicación
  // actual" below — useLocationLock is fire-and-forget (requestLock sets its
  // own status/location state asynchronously), so this is what actually
  // lands the result into selectedLocation once it resolves.
  useEffect(() => {
    if (adminLocationLock.status === 'locked' && adminLocationLock.location) {
      setSelectedLocation({
        latitude: adminLocationLock.location.latitude,
        longitude: adminLocationLock.location.longitude,
        accuracyMeters: adminLocationLock.location.accuracyMeters,
        label: 'Tu ubicación actual',
      });
    } else if (adminLocationLock.status === 'denied') {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tu ubicación para usarla como evidencia.');
    } else if (adminLocationLock.status === 'error') {
      Alert.alert('No se pudo obtener tu ubicación', adminLocationLock.errorMessage ?? 'Intenta de nuevo.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the lock's own state, not every render
  }, [adminLocationLock.status, adminLocationLock.location]);

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
        p_date: toZonedDateString(activationDate, group?.timezone ?? 'America/Bogota'),
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

  const handleSavePenaltyStartDate = async () => {
    if (!selectedMember) return;
    setIsSavingPenaltyStart(true);
    try {
      const { error } = await supabase.rpc('admin_set_member_penalty_start_date', {
        p_member_id: selectedMember.id,
        p_date: toZonedDateString(penaltyStartDate, group?.timezone ?? 'America/Bogota'),
      });
      if (error) throw new Error(error.message);
      await refreshMembers();
      Alert.alert('Listo', 'Se actualizó la fecha de inicio de penalizaciones.');
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingPenaltyStart(false);
    }
  };

  const handleSetDayStatus = async (status: 'valid' | 'failed') => {
    if (!group || !selectedUserId) return;
    setIsSubmittingAttendance(true);
    try {
      const { error } = await supabase.rpc('set_attendance_override', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_date: toZonedDateString(attendanceDate, group.timezone),
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
        p_date: toZonedDateString(attendanceDate, group.timezone),
      });
      if (error) throw new Error(error.message);
      await refreshDayStatus();
    } catch (err) {
      Alert.alert('No se pudo quitar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmittingAttendance(false);
    }
  };

  const handleMarkExcused = async () => {
    if (!group || !selectedUserId) return;
    setIsMarkingExcused(true);
    try {
      const { error } = await supabase.rpc('admin_set_excused_day', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_date: toZonedDateString(attendanceDate, group.timezone),
        p_excuse_type: markExcuseType,
        p_note: attendanceNote || null,
      });
      if (error) throw new Error(error.message);
      setAttendanceNote('');
      await refreshDayStatus();
    } catch (err) {
      Alert.alert('No se pudo marcar como excusado', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsMarkingExcused(false);
    }
  };

  const pickEvidencePhoto = async (onPicked: (uri: string) => void) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus fotos para adjuntar la evidencia.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) onPicked(result.assets[0].uri);
  };

  const handleMapPick = (location: MapPickedLocation) => {
    setSelectedLocation({ ...location, label: 'Ubicación elegida en el mapa' });
    setIsMapPickerOpen(false);
  };

  const toTimeString = (date: Date): string => {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}:00`;
  };

  const handleCreateManualCheckin = async () => {
    if (!group || !selectedUserId) return;
    if (!initialPhotoUri) {
      Alert.alert('Falta la foto inicial', 'Elige la foto que va a quedar como evidencia de inicio.');
      return;
    }
    if (sameFinalPhoto === 'no' && !finalPhotoUri) {
      Alert.alert('Falta la foto final', 'Elige la foto final, o marca "usar la misma" que la inicial.');
      return;
    }
    if (!selectedLocation) {
      Alert.alert(
        'Falta la ubicación',
        'Elige una ubicación anterior de este jugador, usa tu ubicación actual, o elígela en el mapa.'
      );
      return;
    }
    if (withDuration === 'yes' && toTimeString(evidenceStartTime) === toTimeString(evidenceEndTime)) {
      Alert.alert('Hora inválida', 'La hora final debe ser distinta a la hora de inicio.');
      return;
    }
    setIsSavingEvidence(true);
    try {
      const dateString = toZonedDateString(attendanceDate, group.timezone);
      const initialPath = checkinPhotoPath(group.id, selectedUserId, dateString);
      await uploadImage('checkins', initialPath, initialPhotoUri);

      let finalPath = initialPath;
      if (sameFinalPhoto === 'no' && finalPhotoUri) {
        finalPath = checkoutPhotoPath(group.id, selectedUserId, dateString);
        await uploadImage('checkins', finalPath, finalPhotoUri);
      }

      const { error } = await supabase.rpc('admin_create_checkin', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_date: dateString,
        p_photo_path: initialPath,
        p_checkout_photo_path: finalPath,
        p_latitude: selectedLocation.latitude,
        p_longitude: selectedLocation.longitude,
        p_location_accuracy_m: selectedLocation.accuracyMeters,
        p_start_time: withDuration === 'yes' ? toTimeString(evidenceStartTime) : null,
        p_end_time: withDuration === 'yes' ? toTimeString(evidenceEndTime) : null,
        p_active_energy_kcal: evidenceCalories ? Number(evidenceCalories) : null,
      });
      if (error) throw new Error(error.message);
      await refreshDayStatus();
      Alert.alert('Listo', 'Se registró el entreno con la evidencia adjunta.');
    } catch (err) {
      Alert.alert('No se pudo registrar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingEvidence(false);
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

  const handleConfirmDepositWithoutReceipt = async () => {
    if (!group || !selectedUserId) return;
    const numeric = Number(depositAmount);
    if (!depositAmount || Number.isNaN(numeric) || numeric <= 0) {
      Alert.alert('Monto inválido', 'Ingresa un monto mayor a 0.');
      return;
    }
    setIsConfirmingDeposit(true);
    try {
      const { error } = await supabase.rpc('admin_confirm_deposit_without_receipt', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_amount: numeric,
      });
      if (error) throw new Error(error.message);
      await refreshMembers();
      Alert.alert('Listo', 'El depósito quedó confirmado y el miembro ya está activo.');
    } catch (err) {
      Alert.alert('No se pudo confirmar el depósito', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsConfirmingDeposit(false);
    }
  };

  const confirmRemove = () => {
    if (!selectedMember) return;
    const name = selectedMember.profile.full_name;
    if (group && group.payout_mode !== 'league') {
      Alert.alert('Sacar del grupo', `¿Sacar a ${name} del grupo? No podrá volver a entrar con el código de invitación.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sacar y pagar su parte', onPress: () => handleRemove(true) },
        { text: 'Sacar sin pagar', style: 'destructive', onPress: () => handleRemove(false) },
      ]);
      return;
    }
    Alert.alert(
      'Sacar del grupo',
      `¿Sacar a ${name} del grupo? No podrá volver a entrar con el código de invitación.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sacar', style: 'destructive', onPress: () => handleRemove(false) },
      ]
    );
  };

  const handleRemove = async (payOut: boolean) => {
    if (!selectedMember) return;
    setIsRemoving(true);
    try {
      const { error } = await supabase.rpc('admin_remove_member', {
        p_member_id: selectedMember.id,
        p_pay_out: payOut,
      });
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

  const handleAllowRejoin = async () => {
    if (!selectedMember) return;
    setIsAllowingRejoin(true);
    try {
      const { error } = await supabase.rpc('admin_allow_rejoin', { p_member_id: selectedMember.id });
      if (error) throw new Error(error.message);
      await refreshMembers();
      Alert.alert('Listo', 'Ya puede volver a entrar al grupo con el código de invitación.');
    } catch (err) {
      Alert.alert('No se pudo permitir el reingreso', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsAllowingRejoin(false);
    }
  };

  // Mirrors classifyMemberDay's own precedence (attendance.ts): a real
  // check-in or a 'valid' override always reads as completed first; only
  // then does an excuse win out over a 'failed' override.
  const dayStatusLabel = dayStatusLoading
    ? 'Revisando...'
    : hasCheckin || currentOverride?.status === 'valid'
      ? hasCheckin
        ? 'Día registrado (check-in)'
        : 'Marcado válido por el admin'
      : excusedType
        ? `Excusado (${EXCUSE_TYPE_LABELS[excusedType]})`
        : currentOverride?.status === 'failed'
          ? 'Marcado fallado por el admin'
          : 'Sin registro';

  const dayStatusTone =
    hasCheckin || currentOverride?.status === 'valid'
      ? 'success'
      : excusedType
        ? 'warning'
        : currentOverride?.status === 'failed'
          ? 'danger'
          : 'neutral';

  return (
    <>
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
            <Text style={styles.sectionTitle}>Fecha de inicio de penalizaciones</Text>
            <Text style={styles.sectionHint}>
              Actual:{' '}
              {new Date(
                selectedMember.penalty_start_date ?? selectedMember.activated_at ?? selectedMember.joined_at
              ).toLocaleDateString('es-CO')}
            </Text>
            <Text style={styles.sectionHint}>
              El jugador cuenta normal para ranking, consistencia y logros desde su fecha de entrada — esta fecha
              solo controla desde cuándo se le puede cobrar una penalización en dinero. Déjala igual a la fecha de
              entrada si quieres que las penalizaciones apliquen de inmediato.
            </Text>
            <InlineDatePicker value={penaltyStartDate} onChange={setPenaltyStartDate} />
            <Button label="Guardar fecha" onPress={handleSavePenaltyStartDate} loading={isSavingPenaltyStart} />
          </Card>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Asignar día válido/fallado</Text>
            <InlineDatePicker value={attendanceDate} onChange={setAttendanceDate} maximumDate={new Date()} />
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

            {!hasCheckin && !excusedType ? (
              <View style={styles.toggleField}>
                <Text style={styles.toggleLabel}>O marcar como excusado</Text>
                <SegmentedControl options={EXCUSE_TYPE_OPTIONS} value={markExcuseType} onChange={setMarkExcuseType} />
                <Button
                  label="Marcar excusado"
                  variant="secondary"
                  onPress={handleMarkExcused}
                  loading={isMarkingExcused}
                />
              </View>
            ) : null}

            {currentOverride ? (
              <Button
                label="Quitar asignación"
                variant="secondary"
                onPress={handleClearDayStatus}
                loading={isSubmittingAttendance}
              />
            ) : null}

            {!hasCheckin ? (
              <View style={styles.evidenceSection}>
                <View style={styles.toggleField}>
                  <Text style={styles.toggleLabel}>
                    ¿Marcar válido con evidencia (foto, ubicación, duración, calorías)?
                  </Text>
                  <SegmentedControl options={YES_NO_OPTIONS} value={withEvidence} onChange={setWithEvidence} />
                </View>
                {withEvidence === 'yes' ? (
                  <>
                    <Pressable onPress={() => pickEvidencePhoto(setInitialPhotoUri)} style={styles.photoPick}>
                      {initialPhotoUri ? (
                        <Image source={{ uri: initialPhotoUri }} style={styles.photoPreview} />
                      ) : (
                        <Text style={styles.photoPickText}>📸 Elegir foto inicial</Text>
                      )}
                    </Pressable>
                    <View style={styles.toggleField}>
                      <Text style={styles.toggleLabel}>¿Usar la misma foto como foto final?</Text>
                      <SegmentedControl options={YES_NO_OPTIONS} value={sameFinalPhoto} onChange={setSameFinalPhoto} />
                    </View>
                    {sameFinalPhoto === 'no' ? (
                      <Pressable onPress={() => pickEvidencePhoto(setFinalPhotoUri)} style={styles.photoPick}>
                        {finalPhotoUri ? (
                          <Image source={{ uri: finalPhotoUri }} style={styles.photoPreview} />
                        ) : (
                          <Text style={styles.photoPickText}>📸 Elegir foto final</Text>
                        )}
                      </Pressable>
                    ) : null}
                    <View style={styles.toggleField}>
                      <Text style={styles.toggleLabel}>Ubicación</Text>
                      <PreviousLocationPicker
                        locations={memberLocations}
                        isLoading={locationsLoading}
                        selected={selectedLocation}
                        onSelect={setSelectedLocation}
                      />
                      <View style={styles.locationActions}>
                        <Pressable
                          onPress={() => adminLocationLock.requestLock()}
                          style={[
                            styles.locationActionButton,
                            selectedLocation?.label === 'Tu ubicación actual' && styles.locationRowSelected,
                          ]}
                        >
                          {adminLocationLock.status === 'requesting' ? (
                            <ActivityIndicator color={colors.primary} />
                          ) : (
                            <Text
                              style={[
                                styles.locationActionText,
                                selectedLocation?.label === 'Tu ubicación actual' && styles.locationRowTextSelected,
                              ]}
                            >
                              📍 Usar mi ubicación actual
                            </Text>
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => setIsMapPickerOpen(true)}
                          style={[
                            styles.locationActionButton,
                            selectedLocation?.label === 'Ubicación elegida en el mapa' && styles.locationRowSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.locationActionText,
                              selectedLocation?.label === 'Ubicación elegida en el mapa' && styles.locationRowTextSelected,
                            ]}
                          >
                            🗺️ Elegir en el mapa
                          </Text>
                        </Pressable>
                      </View>
                      {selectedLocation ? (
                        <Text style={styles.sectionHint}>Seleccionada: {selectedLocation.label}</Text>
                      ) : null}
                    </View>
                    <View style={styles.toggleField}>
                      <Text style={styles.toggleLabel}>¿Registrar hora de inicio y hora final?</Text>
                      <SegmentedControl options={YES_NO_OPTIONS} value={withDuration} onChange={setWithDuration} />
                    </View>
                    {withDuration === 'yes' ? (
                      <View style={styles.timeRow}>
                        <InlineTimePicker label="Hora de inicio" value={evidenceStartTime} onChange={setEvidenceStartTime} />
                        <InlineTimePicker label="Hora final" value={evidenceEndTime} onChange={setEvidenceEndTime} />
                      </View>
                    ) : null}
                    <TextField
                      label="Calorías (opcional)"
                      value={evidenceCalories}
                      onChangeText={(v) => setEvidenceCalories(v.replace(/[^0-9]/g, ''))}
                      keyboardType="numeric"
                      returnKeyType="done"
                    />
                    <Button label="Registrar entreno" onPress={handleCreateManualCheckin} loading={isSavingEvidence} />
                  </>
                ) : null}
              </View>
            ) : null}
          </Card>

          {selectedMember.status === 'pending_deposit' ? (
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Confirmar depósito sin comprobante</Text>
              <Text style={styles.sectionHint}>
                Úsalo si el pago llegó por fuera de la app (efectivo, u otro medio que ya verificaste) y el miembro no
                necesita subir foto de comprobante. Si ya había enviado una, queda reemplazada por esta confirmación.
              </Text>
              <TextField
                label={`Monto del depósito (${group.currency})`}
                value={depositAmount}
                onChangeText={setDepositAmount}
                keyboardType="numeric"
                placeholder={group.initial_deposit_amount.toLocaleString('es-CO')}
              />
              <Button
                label="Confirmar depósito sin comprobante"
                onPress={handleConfirmDepositWithoutReceipt}
                loading={isConfirmingDeposit}
              />
            </Card>
          ) : null}

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

          {selectedMember.status === 'removed' ? (
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Permitir reingreso</Text>
              <Text style={styles.sectionHint}>
                Este jugador fue sacado del grupo y no puede volver a entrar con el código de invitación. Si querés
                dejarlo volver, esto lo habilita — al reingresar empieza limpio, como si fuera nuevo (no arrastra su
                fecha de entrada ni de penalizaciones anteriores).
              </Text>
              <Button label="Permitir que vuelva a entrar" onPress={handleAllowRejoin} loading={isAllowingRejoin} />
            </Card>
          ) : null}
        </>
      ) : null}

      <Button label="Volver" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
      <LocationMapPickerModal
        visible={isMapPickerOpen}
        initialLocation={adminLocationLock.location}
        onPick={handleMapPick}
        onClose={() => setIsMapPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  memberList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
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
  dayStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionButtons: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  balanceValue: { ...typography.title, color: colors.text },
  adjustmentsList: { gap: spacing.xs, marginTop: spacing.xs },
  adjustmentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adjustmentAmount: { color: colors.success, fontWeight: '700' },
  adjustmentAmountNegative: { color: colors.danger },
  adjustmentDate: { color: colors.textMuted, fontSize: 12 },
  evidenceSection: {
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  toggleField: { gap: spacing.xs },
  toggleLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  photoPick: {
    height: 140,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoPickText: { color: colors.textMuted, fontWeight: '600' },
  photoPreview: { width: '100%', height: '100%' },
  locationList: { gap: spacing.xs },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationRowSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  locationRowText: { color: colors.text, fontSize: 14 },
  locationRowTextSelected: { color: colors.primaryText, fontWeight: '600' },
  locationActions: { flexDirection: 'row', gap: spacing.xs },
  locationActionButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationActionText: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
});
