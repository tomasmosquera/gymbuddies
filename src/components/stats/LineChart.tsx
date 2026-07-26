import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { colors, spacing } from '@/constants/theme';

export interface LineChartSeries {
  label: string;
  color: string;
  /** Aligned 1:1 with the chart's xLabels — null means "no data that period", leaving a gap in the line. */
  values: (number | null)[];
}

interface LineChartProps {
  xLabels: string[];
  series: LineChartSeries[];
  /** Appended to the min/max labels, e.g. '%'. */
  unit?: string;
  height?: number;
}

const CHART_HEIGHT_DEFAULT = 140;
const PADDING_Y = 16;

/**
 * A small, dependency-free multi-series line chart (react-native-svg is
 * already installed) — deliberately minimal: no gridlines, no legend beyond
 * what's passed in, just the trend itself plus the value range for context.
 */
export function LineChart({ xLabels, series, unit = '', height = CHART_HEIGHT_DEFAULT }: LineChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const allValues = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (allValues.length === 0 || xLabels.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Aún no hay suficientes datos.</Text>
      </View>
    );
  }

  const maxValue = Math.max(...allValues);
  const minValue = Math.min(0, ...allValues);
  const range = maxValue - minValue || 1;
  const plotHeight = height - PADDING_Y * 2;

  // The viewBox matches the real measured pixel size 1:1 on both axes, so a
  // Circle's radius renders as an actual circle — a 0-100 abstract x-axis
  // scaled independently from a pixel y-axis would stretch it into an oval.
  const xFor = (index: number) => (xLabels.length > 1 ? (index / (xLabels.length - 1)) * width : width / 2);
  const yFor = (value: number) => PADDING_Y + plotHeight - ((value - minValue) / range) * plotHeight;

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <Line x1={0} y1={height - PADDING_Y} x2={width} y2={height - PADDING_Y} stroke={colors.border} strokeWidth={1} />
          {series.map((s) => {
            const points = s.values
              .map((v, i) => (v === null ? null : { x: xFor(i), y: yFor(v) }))
              .filter((p): p is { x: number; y: number } => p !== null);
            if (points.length === 0) return null;
            const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            return (
              <G key={s.label}>
                <Path d={d} stroke={s.color} strokeWidth={2} fill="none" />
                {points.map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={3} fill={s.color} />
                ))}
              </G>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View style={styles.xLabelRow}>
        {xLabels.map((label, i) => (
          <Text key={i} style={styles.xLabel} numberOfLines={1}>
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.legendRow}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
        <Text style={styles.rangeText}>
          {Math.round(minValue)}
          {unit}–{Math.round(maxValue)}
          {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  xLabelRow: { flexDirection: 'row', marginTop: spacing.xs },
  xLabel: { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  rangeText: { color: colors.textMuted, fontSize: 11, marginLeft: 'auto' },
});
