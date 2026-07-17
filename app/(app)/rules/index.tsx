import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useRuleProposal } from '@/hooks/useRuleProposal';
import { colors, spacing, typography } from '@/constants/theme';

const CHANGE_LABELS: Record<string, string> = {
  min_days_per_week: 'Días mínimos por semana',
  penalty_amount: 'Penalización por día fallado',
  vacation_days_per_month: 'Días de vacaciones al mes',
};

export default function RulesScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading } = useActiveGroup();
  const { proposal, yesCount, noCount, myVote, isLoading: proposalLoading, castVote } = useRuleProposal(
    group?.id ?? null,
    session?.user.id ?? null
  );

  if (groupLoading || proposalLoading || !group || !membership) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isAdmin = membership.role === 'admin';

  const handleVote = async (vote: 'yes' | 'no') => {
    try {
      await castVote(vote);
    } catch (err) {
      Alert.alert('No se pudo votar', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Text style={styles.cardTitle}>Reglas actuales</Text>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Días mínimos por semana</Text>
          <Text style={styles.ruleValue}>{group.min_days_per_week}</Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Penalización por día fallado</Text>
          <Text style={styles.ruleValue}>
            {group.currency} {group.penalty_amount.toLocaleString('es-CO')}
          </Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Días de vacaciones al mes</Text>
          <Text style={styles.ruleValue}>{group.vacation_days_per_month}</Text>
        </View>
      </Card>

      {proposal ? (
        <Card style={styles.proposalCard}>
          <View style={styles.proposalHeader}>
            <Text style={styles.cardTitle}>Votación en curso</Text>
            <Badge label={`Cierra ${new Date(proposal.voting_closes_at).toLocaleDateString('es-CO')}`} />
          </View>
          {Object.entries(proposal.proposed_changes).map(([key, value]) => (
            <Text key={key} style={styles.changeText}>
              {CHANGE_LABELS[key] ?? key}: {String(value)}
            </Text>
          ))}
          <Text style={styles.tally}>
            {yesCount} a favor · {noCount} en contra · se necesitan {proposal.required_votes} votos a favor
          </Text>
          {myVote ? (
            <Text style={styles.myVote}>Ya votaste: {myVote.vote === 'yes' ? 'a favor' : 'en contra'}</Text>
          ) : (
            <View style={styles.voteButtons}>
              <Button label="Votar a favor" onPress={() => handleVote('yes')} />
              <Button label="Votar en contra" variant="secondary" onPress={() => handleVote('no')} />
            </View>
          )}
        </Card>
      ) : isAdmin ? (
        <Button label="Proponer cambio de reglas" variant="secondary" onPress={() => router.push('/rules/propose')} />
      ) : (
        <Card>
          <Text style={styles.emptyText}>No hay ninguna votación activa en este momento.</Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  cardTitle: { ...typography.heading, color: colors.text, marginBottom: spacing.sm },
  ruleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  ruleLabel: { color: colors.textMuted },
  ruleValue: { color: colors.text, fontWeight: '600' },
  proposalCard: { gap: spacing.sm },
  proposalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeText: { color: colors.text },
  tally: { color: colors.textMuted, fontSize: 13 },
  myVote: { color: colors.primary, fontWeight: '600' },
  voteButtons: { gap: spacing.sm, marginTop: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
});
