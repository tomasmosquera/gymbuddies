import { useEffect, useRef } from 'react';
import { Animated, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { CrownIcon } from '@/components/ui/CrownIcon';
import { colors, radii, spacing } from '@/constants/theme';
import { formatDateOnly } from '@/lib/domain/leagueCycle';
import {
  championsOf,
  congratsHeadline,
  myPlaceLine,
  relegatedOf,
  type LeagueCycleResults,
  type LeagueResultRow,
} from '@/lib/domain/leagueResults';

const SILVER = '#C0C8D2';
const BRONZE = '#CD7F32';

interface LeagueCycleResultsModalProps {
  visible: boolean;
  results: LeagueCycleResults | null;
  /** Who is looking — drives the personal headline and the highlighted row. */
  myUserId: string | null;
  /** 'closed' = shown right after the cycle ended (celebration); 'past' = reviewing an earlier cycle from Reglas. */
  variant?: 'closed' | 'past';
  onClose: () => void;
}

function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('es-CO')}`;
}

/** The champion's avatar: the crown in place of initials, same as everywhere else in the app. */
function PersonAvatar({ row, size, isChampion }: { row: LeagueResultRow; size: number; isChampion: boolean }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        isChampion && styles.avatarChampion,
      ]}
    >
      {isChampion ? (
        <CrownIcon size={Math.round(size * 0.62)} />
      ) : (
        <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.38) }]}>{initialsOf(row.fullName)}</Text>
      )}
    </View>
  );
}

function PlaceMark({ place }: { place: number }) {
  const tint = place === 1 ? colors.gold : place === 2 ? SILVER : place === 3 ? BRONZE : null;
  return (
    <View style={[styles.placeMark, tint ? { backgroundColor: tint } : styles.placeMarkPlain]}>
      <Text style={[styles.placeMarkText, tint ? styles.placeMarkTextOnTint : null]}>{place}°</Text>
    </View>
  );
}

/**
 * Shown when the app is opened after a Liga cycle closed: final positions,
 * a congratulation for the winner(s), and the crown on whoever finished 1st
 * (ties included). Purely presentational — feed it a LeagueCycleResults.
 */
export function LeagueCycleResultsModal({
  visible,
  results,
  myUserId,
  variant = 'closed',
  onClose,
}: LeagueCycleResultsModalProps) {
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    fade.setValue(0);
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, [visible, pop, fade]);

  if (!results) return null;

  const champions = championsOf(results.standings);
  const relegated = relegatedOf(results.standings);
  const isPast = variant === 'past';
  const mine = results.standings.find((r) => r.userId === myUserId) ?? null;
  const placeLine = myPlaceLine(results, myUserId);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <Animated.View style={[styles.crownHalo, { transform: [{ scale: pop }] }]}>
                <CrownIcon size={56} />
              </Animated.View>
              <Text style={styles.kicker}>Liga · Ciclo #{results.cycleNumber}</Text>
              <Text style={styles.title}>{isPast ? 'Resultados del ciclo' : '¡Se cerró el ciclo!'}</Text>
              <Text style={styles.dates}>
                {formatDateOnly(results.startDate)} – {formatDateOnly(results.endDate)}
              </Text>
              {results.closedEarly ? (
                <View style={styles.earlyPill}>
                  <Text style={styles.earlyPillText}>Cierre anticipado</Text>
                </View>
              ) : null}
            </View>

            <Animated.View style={{ opacity: fade, gap: spacing.md }}>
              {champions.length === 0 ? (
                <Text style={styles.muted}>No hay resultados guardados de este ciclo.</Text>
              ) : (
              <View style={styles.championsBox}>
                <Text style={styles.championsLabel}>{champions.length > 1 ? 'CAMPEONES' : 'CAMPEÓN'}</Text>
                {champions.map((c) => (
                  <View key={c.userId} style={styles.championRow}>
                    <PersonAvatar row={c} size={48} isChampion />
                    <View style={styles.flex}>
                      <Text style={styles.championName} numberOfLines={1}>
                        {c.fullName}
                        {c.userId === myUserId ? ' (tú)' : ''}
                      </Text>
                      <Text style={styles.muted}>{c.score} pts</Text>
                    </View>
                    {c.prizeAmount > 0 ? <Text style={styles.championPrize}>{money(results.currency, c.prizeAmount)}</Text> : null}
                  </View>
                ))}
                <Text style={styles.congrats}>{congratsHeadline(results, myUserId)}</Text>
              </View>
              )}

              {mine && placeLine ? (
                <View style={styles.mineBox}>
                  <Text style={styles.mineTitle}>{placeLine}</Text>
                  <Text style={styles.muted}>
                    {mine.prizeAmount > 0
                      ? `Te llevas ${money(results.currency, mine.prizeAmount)} del premio.`
                      : isPast
                        ? 'Este puesto no llevó premio.'
                        : 'Este puesto no lleva premio — ¡ve por la corona en el próximo ciclo!'}
                  </Text>
                  {mine.relegated ? (
                    <Text style={styles.relegatedText}>
                      Quedaste en zona de descenso
                      {mine.descensoAmount > 0 ? ` (multa de ${money(results.currency, mine.descensoAmount)})` : ''}.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {results.standings.length > 0 ? (
              <View>
                <Text style={styles.sectionTitle}>{results.partial ? 'Puestos con premio' : 'Posiciones finales'}</Text>
                {results.partial ? (
                  <Text style={[styles.muted, styles.partialNote]}>
                    Este ciclo se cerró antes de que se guardaran las posiciones completas: solo se muestran los puestos que llevaron premio.
                  </Text>
                ) : null}
                {results.standings.map((row) => {
                  const isChampion = row.place === 1;
                  const isMe = row.userId === myUserId;
                  return (
                    <View key={row.userId} style={[styles.standingRow, isMe && styles.standingRowMe]}>
                      <PlaceMark place={row.place} />
                      <PersonAvatar row={row} size={34} isChampion={isChampion} />
                      <View style={styles.flex}>
                        <Text style={styles.standingName} numberOfLines={1}>
                          {row.fullName}
                          {isMe ? ' (tú)' : ''}
                        </Text>
                        <Text style={styles.muted}>{results.partial ? 'Con premio' : `${row.score} pts`}</Text>
                      </View>
                      {row.relegated ? (
                        <View style={styles.relegatedPill}>
                          <Text style={styles.relegatedPillText}>Descenso</Text>
                        </View>
                      ) : null}
                      <Text style={[styles.standingPrize, row.prizeAmount <= 0 && styles.muted]}>
                        {row.prizeAmount > 0 ? money(results.currency, row.prizeAmount) : '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>
              ) : null}

              {relegated.length > 0 ? (
                <View style={styles.relegatedBox}>
                  <Text style={styles.relegatedLabel}>ZONA DE DESCENSO</Text>
                  {relegated.map((r) => (
                    <View key={r.userId} style={styles.relegatedRow}>
                      <PersonAvatar row={r} size={30} isChampion={false} />
                      <Text style={[styles.standingName, styles.flex]} numberOfLines={1}>
                        {r.fullName}
                        {r.userId === myUserId ? ' (tú)' : ''} · {r.place}°
                      </Text>
                      <Text style={styles.relegatedAmount}>
                        {r.descensoAmount > 0 ? `−${money(results.currency, r.descensoAmount)}` : 'Sin multa'}
                      </Text>
                    </View>
                  ))}
                  <Text style={styles.muted}>
                    Los últimos lugares del ranking. Lo que pagaron se sumó al premio de este mismo ciclo.
                  </Text>
                </View>
              ) : null}

              <View style={styles.footerNote}>
                {results.poolAmount > 0 ? (
                  <Text style={styles.muted}>Fondo repartido: {money(results.currency, results.poolAmount)}</Text>
                ) : null}
                {isPast ? null : (
                  <Text style={styles.muted}>
                    {results.autoRenewed
                      ? 'Ya arrancó un ciclo nuevo — ¡a defender (o a conquistar) la corona!'
                      : 'La Liga queda en pausa hasta que el administrador inicie el próximo ciclo.'}
                  </Text>
                )}
              </View>
            </Animated.View>
          </ScrollView>
          <View style={styles.footer}>
            <Button label={isPast ? 'Cerrar' : 'Continuar'} onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.gold,
    overflow: 'hidden',
  },
  content: { padding: spacing.lg, gap: spacing.md },
  hero: { alignItems: 'center', gap: spacing.xs },
  crownHalo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(245,197,66,0.14)',
    borderWidth: 2,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  kicker: { color: colors.gold, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  dates: { color: colors.textMuted, fontSize: 13 },
  earlyPill: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  earlyPillText: { color: colors.warning, fontSize: 12, fontWeight: '600' },
  championsBox: {
    backgroundColor: 'rgba(245,197,66,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.45)',
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  championsLabel: { color: colors.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  championRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  championName: { color: colors.text, fontSize: 18, fontWeight: '700' },
  championPrize: { color: colors.gold, fontSize: 15, fontWeight: '700' },
  congrats: { color: colors.text, fontSize: 15, lineHeight: 21 },
  mineBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
  },
  mineTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  standingRowMe: { backgroundColor: colors.surfaceAlt, borderRadius: radii.sm },
  standingName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  standingPrize: { color: colors.text, fontSize: 14, fontWeight: '700' },
  placeMark: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  placeMarkPlain: { backgroundColor: colors.surfaceAlt },
  placeMarkText: { color: colors.textMuted, fontSize: 13, fontWeight: '800' },
  placeMarkTextOnTint: { color: '#1A1300' },
  avatar: { backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  avatarChampion: { borderWidth: 1.5, borderColor: colors.gold, backgroundColor: 'rgba(245,197,66,0.12)' },
  avatarText: { color: colors.text, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 13 },
  footerNote: { gap: spacing.xs },
  partialNote: { marginBottom: spacing.xs },
  relegatedText: { color: colors.danger, fontSize: 13, fontWeight: '600', marginTop: 2 },
  relegatedPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  relegatedPillText: { color: colors.danger, fontSize: 10, fontWeight: '700' },
  relegatedBox: {
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.4)',
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  relegatedLabel: { color: colors.danger, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  relegatedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  relegatedAmount: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
});
