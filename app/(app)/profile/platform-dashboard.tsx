import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarList } from '@/components/stats/BarList';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformAdminOverview } from '@/hooks/usePlatformAdminOverview';
import { PAYOUT_MODE_LABELS } from '@/constants/payoutModes';
import type { PayoutMode } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

// Same UI-only gate as admin-credits.tsx/create-group.tsx — the real
// authority is server-side (both RPCs behind usePlatformAdminOverview check
// profiles.is_platform_admin themselves), this only decides who sees the
// screen at all.
const PLATFORM_ADMIN_EMAIL = 'tomasmosquera@hotmail.com';

// A group with no check-in in this many days reads as "gone quiet" — not a
// hard rule, just a heads-up flag in the list.
const INACTIVE_DAYS_THRESHOLD = 14;

// Cooperative/League/Mixed each get their own accent — same tone vocabulary
// Badge already uses everywhere else, just applied consistently per mode
// instead of every group card looking identical regardless of mode.
const PAYOUT_MODE_TONE: Record<PayoutMode, 'success' | 'warning' | 'neutral'> = {
  cooperative: 'success',
  league: 'warning',
  mixed: 'neutral',
};
const PAYOUT_MODE_ACCENT: Record<PayoutMode, string> = {
  cooperative: colors.success,
  league: colors.warning,
  mixed: colors.textMuted,
};

function SectionLabel({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={18} color={colors.text} />
      <Text style={styles.sectionLabel}>{children}</Text>
    </View>
  );
}

function StatTile({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

function MoneyTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.moneyTile}>
      <Text style={styles.moneyValue}>{value}</Text>
      <Text style={styles.moneyLabel}>{label}</Text>
    </View>
  );
}

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null;
  return Math.floor((Date.now() - new Date(dateString).getTime()) / (24 * 60 * 60 * 1000));
}

export default function PlatformDashboardScreen() {
  const { session } = useAuth();
  const isPlatformAdmin = session?.user.email === PLATFORM_ADMIN_EMAIL;
  const { overview, groups, isLoading, error, refresh } = usePlatformAdminOverview(isPlatformAdmin);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (!isPlatformAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.subtitle}>No tienes acceso a esta pantalla.</Text>
      </View>
    );
  }

  if (isLoading && !overview) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !overview) {
    return (
      <View style={styles.center}>
        <Text style={styles.subtitle}>{error ?? 'No se pudo cargar el panel.'}</Text>
      </View>
    );
  }

  const activeSharePercent = overview.totalGroups > 0 ? Math.round((overview.activeGroups / overview.totalGroups) * 100) : 0;
  const modeItems = [
    { label: 'Cooperativo', ratio: overview.totalGroups > 0 ? overview.cooperativeCount / overview.totalGroups : 0, valueLabel: `${overview.cooperativeCount}`, highlight: false },
    { label: 'Liga', ratio: overview.totalGroups > 0 ? overview.leagueCount / overview.totalGroups : 0, valueLabel: `${overview.leagueCount}`, highlight: false },
    { label: 'Mixto', ratio: overview.totalGroups > 0 ? overview.mixedCount / overview.totalGroups : 0, valueLabel: `${overview.mixedCount}`, highlight: false },
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.primary} />}
    >
      {/* --- Hero --- */}
      <Card style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Ionicons name="planet-outline" size={22} color={colors.primary} />
          <Text style={styles.heroTitle}>Gym Buddies · Plataforma</Text>
        </View>
        <View style={styles.heroStatsRow}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{overview.activeGroups}</Text>
            <Text style={styles.heroStatLabel}>grupos activos de {overview.totalGroups}</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{overview.totalActiveUniqueMembers}</Text>
            <Text style={styles.heroStatLabel}>personas únicas jugando</Text>
          </View>
        </View>
        <Text style={styles.heroFootnote}>{activeSharePercent}% de los grupos creados están activos ahora mismo</Text>
      </Card>

      <View>
        <SectionLabel icon="stats-chart-outline">RESUMEN</SectionLabel>
        <Card style={[styles.card, styles.tileRow]}>
          <StatTile icon="albums-outline" label="Grupos totales" value={`${overview.totalGroups}`} />
          <StatTile icon="flash-outline" label="Grupos activos" value={`${overview.activeGroups}`} />
          <StatTile icon="people-outline" label="Membresías activas" value={`${overview.totalActiveMembers}`} />
          <StatTile icon="person-outline" label="Miembros activos únicos" value={`${overview.totalActiveUniqueMembers}`} />
        </Card>
      </View>

      <View>
        <SectionLabel icon="cash-outline">DINERO EN LA PLATAFORMA</SectionLabel>
        <Card style={[styles.card, styles.moneyRow]}>
          <MoneyTile label="Balance total (COP)" value={Math.round(overview.totalBalance).toLocaleString('es-CO')} />
          <MoneyTile label="Penalizaciones cobradas (COP)" value={Math.round(overview.totalPenaltiesCollected).toLocaleString('es-CO')} />
        </Card>
      </View>

      <View>
        <SectionLabel icon="game-controller-outline">MODOS DE JUEGO</SectionLabel>
        <Card style={styles.card}>
          <BarList items={modeItems} color={colors.primary} />
        </Card>
      </View>

      <View>
        <SectionLabel icon="business-outline">{`GRUPOS (${groups.length})`}</SectionLabel>
        {groups.map((g) => {
          const inactiveDays = daysSince(g.lastCheckinAt);
          const isQuiet = inactiveDays === null || inactiveDays > INACTIVE_DAYS_THRESHOLD;
          return (
            <Card key={g.id} style={[styles.groupCard, { borderLeftColor: PAYOUT_MODE_ACCENT[g.payoutMode] }]}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupName} numberOfLines={1}>
                  {g.name}
                </Text>
                <Badge label={PAYOUT_MODE_LABELS[g.payoutMode]} tone={PAYOUT_MODE_TONE[g.payoutMode]} />
              </View>
              <Text style={styles.groupMeta}>Admin: {g.adminName ?? '—'}</Text>
              <View style={styles.groupStatsRow}>
                <View style={styles.groupStatItem}>
                  <Ionicons name="people-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.groupStat}>{g.activeMemberCount}</Text>
                </View>
                <View style={styles.groupStatItem}>
                  <Ionicons name="cash-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.groupStat}>
                    {g.currency} {Math.round(g.totalBalance).toLocaleString('es-CO')}
                  </Text>
                </View>
                <View style={styles.groupStatItem}>
                  <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.groupStat}>{new Date(g.createdAt).toLocaleDateString('es-CO')}</Text>
                </View>
              </View>
              {isQuiet ? (
                <Badge
                  label={inactiveDays === null ? '⚠️ Sin check-ins nunca' : `⚠️ Sin check-ins hace ${inactiveDays} día(s)`}
                  tone="warning"
                />
              ) : null}
            </Card>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.lg },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  sectionLabel: { color: colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 0.3 },
  card: { gap: spacing.sm, marginBottom: spacing.sm },
  tileRow: { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap', rowGap: spacing.md },
  statTile: { alignItems: 'center', gap: 2, minWidth: 72 },
  statTileValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  statTileLabel: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },

  // Hero
  heroCard: { gap: spacing.md, borderWidth: 1, borderColor: colors.primary },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroTitle: { ...typography.heading, color: colors.text },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: colors.primary, fontSize: 30, fontWeight: '800' },
  heroStatLabel: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 2 },
  heroDivider: { width: 1, height: 40, backgroundColor: colors.border },
  heroFootnote: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  // Money
  moneyRow: { flexDirection: 'row', gap: spacing.md },
  moneyTile: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    gap: 2,
  },
  moneyValue: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  moneyLabel: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 2 },

  // Group list
  groupCard: { gap: spacing.xs, marginBottom: spacing.sm, borderLeftWidth: 3 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  groupName: { ...typography.heading, fontSize: 15, color: colors.text, flex: 1 },
  groupMeta: { color: colors.textMuted, fontSize: 12 },
  groupStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  groupStatItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  groupStat: { color: colors.text, fontSize: 12, fontWeight: '600' },
});
