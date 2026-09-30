import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { colors, spacing } from '@/constants/theme';

export interface RadarChartSeries {
  label: string;
  color: string;
  /** 0-100, aligned 1:1 with `axes` — usually a percentile (see computeRadarValues), not a raw metric, so wildly different units all plot on one shared scale. */
  values: number[];
}

interface RadarChartProps {
  axes: string[];
  series: RadarChartSeries[];
  size?: number;
}

const RING_COUNT = 4; // 25/50/75/100%
const LABEL_MARGIN = 50; // room outside the plot circle for axis labels

/** A point `radius` out from the shared center, at axis `index` of `total` — evenly spaced starting straight up (12 o'clock), going clockwise. */
function pointFor(index: number, total: number, radius: number, center: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
}

function polygonPoints(values: number[], maxRadius: number, center: number): string {
  return values.map((v, i) => pointFor(i, values.length, (Math.max(0, Math.min(100, v)) / 100) * maxRadius, center)).map((p) => `${p.x},${p.y}`).join(' ');
}

/**
 * A small, dependency-free radar/spider chart (react-native-svg is already
 * installed, see LineChart.tsx) — "Cara a Cara"'s at-a-glance shape for how
 * two members compare across several axes at once, before the detailed
 * VersusBar-by-VersusBar breakdown below it. Every axis is assumed already
 * normalized to 0-100 (computeRadarValues does this via percentile rank) —
 * this component only draws, it doesn't normalize.
 */
export function RadarChart({ axes, series, size = 280 }: RadarChartProps) {
  const center = size / 2;
  const maxRadius = center - LABEL_MARGIN;

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        {/* Concentric rings, faint — pure scale reference, no labels (the
            legend below plus each series' own shape is what actually reads). */}
        {Array.from({ length: RING_COUNT }, (_, i) => {
          const ringRadius = (maxRadius * (i + 1)) / RING_COUNT;
          const points = axes.map((_, a) => pointFor(a, axes.length, ringRadius, center)).map((p) => `${p.x},${p.y}`).join(' ');
          return <Polygon key={i} points={points} fill="none" stroke={colors.border} strokeWidth={1} />;
        })}

        {/* One spoke per axis, center to the outer ring. */}
        {axes.map((_, i) => {
          const p = pointFor(i, axes.length, maxRadius, center);
          return <Line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke={colors.border} strokeWidth={1} />;
        })}

        {/* One filled polygon (+ vertex dots) per series — "Tú" vs the picked teammate. */}
        {series.map((s) => (
          <Polygon key={s.label} points={polygonPoints(s.values, maxRadius, center)} fill={s.color} fillOpacity={0.22} stroke={s.color} strokeWidth={2} />
        ))}
        {series.map((s) =>
          s.values.map((v, i) => {
            const p = pointFor(i, axes.length, (Math.max(0, Math.min(100, v)) / 100) * maxRadius, center);
            return <Circle key={`${s.label}-${i}`} cx={p.x} cy={p.y} r={3} fill={s.color} />;
          })
        )}

        {/* Axis labels, just past the outer ring — anchor flips (start/middle/end)
            based on which side of the circle the label falls on, so it grows away
            from the chart instead of overlapping it. */}
        {axes.map((label, i) => {
          const p = pointFor(i, axes.length, maxRadius + 14, center);
          const dx = p.x - center;
          const anchor = Math.abs(dx) < maxRadius * 0.15 ? 'middle' : dx > 0 ? 'start' : 'end';
          return (
            <SvgText key={i} x={p.x} y={p.y + 4} fontSize={11} fill={colors.textMuted} textAnchor={anchor}>
              {label}
            </SvgText>
          );
        })}
      </Svg>

      <View style={styles.legendRow}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText} numberOfLines={1}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
});
