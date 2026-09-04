import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/constants/theme';

export interface VoteBreakdownPerson {
  userId: string;
  fullName: string;
}

interface VoteBreakdownProps {
  /** Green group — "a favor" for a rule/excuse vote, "votos por validar" for a challenge/KOTH invalidate vote. The caller decides which raw yes/no bucket goes here, since "yes" doesn't always mean "favor" (see rules/index.tsx's bucketVotes call sites). */
  favor: VoteBreakdownPerson[];
  /** Red group — the inverse of `favor` (en contra / votos por invalidar). */
  contra: VoteBreakdownPerson[];
  pending: VoteBreakdownPerson[];
  /** Defaults match the plain "a favor / en contra" wording a rule or excuse vote uses. */
  favorLabel?: string;
  contraLabel?: string;
}

type Tone = 'success' | 'danger' | 'neutral';

// Same bg/fg pairing Badge.tsx already uses for these tones — a chip here
// should read as "the same success/danger/neutral language", not a
// competing palette.
const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: '#123424', fg: colors.success },
  danger: { bg: '#3A1414', fg: colors.danger },
  neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
};

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

// Collapsed by default — tapping a group is what reveals who's actually in
// it, so a vote with a lot of members doesn't dump every name on screen at
// once for a card whose main job is just the tally.
function VoteGroup({ label, tone, people }: { label: string; tone: Tone; people: VoteBreakdownPerson[] }) {
  const [expanded, setExpanded] = useState(false);
  if (people.length === 0) return null;
  const { fg } = TONE_COLORS[tone];
  return (
    <View style={styles.group}>
      <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8} style={styles.groupHeader}>
        <Text style={[styles.groupLabel, { color: fg }]}>
          {label} ({people.length})
        </Text>
        <Text style={[styles.chevron, { color: fg }]}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? <VoteChips tone={tone} people={people} /> : null}
    </View>
  );
}

function VoteChips({ tone, people }: { tone: Tone; people: VoteBreakdownPerson[] }) {
  const { bg, fg } = TONE_COLORS[tone];
  return (
    <View style={styles.chipRow}>
      {people.map((p) => (
        <View key={p.userId} style={[styles.chip, { backgroundColor: bg }]}>
          <View style={[styles.avatar, { borderColor: fg }]}>
            <Text style={[styles.avatarText, { color: fg }]}>{initials(p.fullName)}</Text>
          </View>
          <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
            {firstName(p.fullName)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Who's who on an open group vote — green (favor)/red (contra)/gray (faltan), each collapsed behind a tap so the card stays compact until someone actually wants the names. Any group with nobody in it is simply omitted (e.g. a brand-new vote shows only "Faltan por votar"). */
export function VoteBreakdown({ favor, contra, pending, favorLabel = 'A favor', contraLabel = 'En contra' }: VoteBreakdownProps) {
  if (favor.length + contra.length + pending.length === 0) return null;
  return (
    <View style={styles.container}>
      <VoteGroup label={favorLabel} tone="success" people={favor} />
      <VoteGroup label={contraLabel} tone="danger" people={contra} />
      <VoteGroup label="Faltan por votar" tone="neutral" people={pending} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  group: { gap: spacing.xs, alignItems: 'center' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  groupLabel: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  chevron: { fontSize: 11, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingRight: spacing.sm,
    paddingLeft: 4,
    borderRadius: radii.pill,
    maxWidth: 140,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 9, fontWeight: '700' },
  chipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
});
