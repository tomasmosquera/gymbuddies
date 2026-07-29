import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
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
  /** Appended to the Y-axis tick labels, e.g. '%'. */
  unit?: string;
  height?: number;
  /**
   * When there are more points than this, the plot area becomes horizontally
   * scrollable at a fixed per-point width instead of squeezing every x-label
   * into the card, and defaults scrolled to the end so the most recent
   * points are what's visible first (older history is a swipe left away).
   * Omit to always stretch every point to fill the card.
   */
  visiblePoints?: number;
}

const CHART_HEIGHT_DEFAULT = 140;
const PADDING_Y = 16;
const Y_AXIS_WIDTH = 40;
const Y_AXIS_TICKS = 4;

/**
 * A small, dependency-free multi-series line chart (react-native-svg is
 * already installed) — deliberately minimal: no legend beyond what's passed
 * in, just the trend itself plus a Y-axis for scale. The Y-axis is a
 * separate, non-scrolling SVG so its labels stay put while the plot itself
 * scrolls horizontally (see visiblePoints).
 */
export function LineChart({ xLabels, series, unit = '', height = CHART_HEIGHT_DEFAULT, visiblePoints }: LineChartProps) {
  const [viewportWidth, setViewportWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setViewportWidth(e.nativeEvent.layout.width);
  const scrollRef = useRef<ScrollView>(null);

  const pointCount = xLabels.length;
  // Content is at least as wide as the viewport (so a short series still
  // fills the card) but grows past it once there are more points than
  // visiblePoints allows to fit at a readable width each.
  const plotWidth =
    visiblePoints && pointCount > visiblePoints
      ? Math.max((viewportWidth / visiblePoints) * pointCount, viewportWidth)
      : viewportWidth;

  // Default scrolled to the end (most recent point) rather than the start —
  // re-fires whenever the content width actually changes: the first real
  // layout measurement, and again whenever the caller swaps periods (day/
  // week/month) and hands this same chart instance a differently-sized series.
  useEffect(() => {
    if (visiblePoints && pointCount > visiblePoints) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [plotWidth, pointCount, visiblePoints]);

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
  const ticks = Array.from({ length: Y_AXIS_TICKS }, (_, i) => minValue + (range * i) / (Y_AXIS_TICKS - 1));
  const yFor = (value: number) => PADDING_Y + plotHeight - ((value - minValue) / range) * plotHeight;

  // The viewBox matches the real measured pixel size 1:1 on both axes, so a
  // Circle's radius renders as an actual circle — a 0-100 abstract x-axis
  // scaled independently from a pixel y-axis would stretch it into an oval.
  const xFor = (index: number) => (pointCount > 1 ? (index / (pointCount - 1)) * plotWidth : plotWidth / 2);

  return (
    <View>
      <View style={styles.row}>
        {viewportWidth > 0 ? (
          <Svg width={Y_AXIS_WIDTH} height={height}>
            {ticks.map((tick, i) => (
              <SvgText key={i} x={Y_AXIS_WIDTH - 6} y={yFor(tick) + 3} fontSize={9} fill={colors.textMuted} textAnchor="end">
                {`${Math.round(tick)}${unit}`}
              </SvgText>
            ))}
          </Svg>
        ) : (
          <View style={{ width: Y_AXIS_WIDTH, height }} />
        )}
        <View style={styles.scrollArea} onLayout={onLayout}>
          {viewportWidth > 0 ? (
            <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <Svg width={plotWidth} height={height}>
                  {ticks.map((tick, i) => (
                    <Line key={i} x1={0} y1={yFor(tick)} x2={plotWidth} y2={yFor(tick)} stroke={colors.border} strokeWidth={1} />
                  ))}
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
                <View style={[styles.xLabelRow, { width: plotWidth }]}>
                  {xLabels.map((label, i) => (
                    <Text key={i} style={styles.xLabel} numberOfLines={1}>
                      {label}
                    </Text>
                  ))}
                </View>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </View>
      <View style={styles.legendRow}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  row: { flexDirection: 'row' },
  scrollArea: { flex: 1 },
  xLabelRow: { flexDirection: 'row', marginTop: spacing.xs },
  xLabel: { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
});
