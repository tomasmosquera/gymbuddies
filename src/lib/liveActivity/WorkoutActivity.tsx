import { HStack, Link, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { LiveActivityContent } from '@/lib/domain/liveActivityContent';

/**
 * The ONE Live Activity/Dynamic Island slot this app uses, shared by two unrelated things —
 * `content.kind` says which: the pending-checkout-photo timer (unchanged from before routine
 * mode existed), or an in-progress routine, switching further between "training" (elapsed count-up
 * + sets progress) and "resting" (a live countdown to when rest ends) depending on whether
 * `restEndAt` is set. Everything inside a 'widget' component runs in the widget's own isolated
 * runtime: only @expo/ui/swift-ui components, no hooks, no app state, no async work — so it cannot
 * import from the rest of the app at runtime: only types are imported (they erase), and every deep
 * link a button needs arrives inside the props. Kept as one function (rather than split into
 * per-mode helpers) since the 'widget' directive marks this exact function for extraction into
 * SwiftUI — the two modes are unified below into a shared set of display variables instead.
 *
 * The clocks are drawn by the system (`timerInterval`), so they keep ticking with the app closed
 * and need no updates or pushes. A SwiftUI timer text is greedy — it stretches to whatever width
 * it is offered — so every one of them is given an explicit frame: a fixed width where it sits
 * next to other things, a very wide frame plus centered alignment where it should be centered.
 *
 * iOS caps the lock-screen banner at about 160 pt of height and clips whatever does not fit, so the
 * banner below is budgeted to stay around 135 pt (5 rows + 4 gaps + 24 pt of vertical padding).
 * `ProgressView(timerInterval:)` draws its own remaining-time label under the bar; it is hidden
 * (`labelsHidden`) because the banner already has its own label row next to (or under) it.
 */
const WorkoutActivity = (content: LiveActivityContent, environment: LiveActivityEnvironment) => {
  'widget';
  const green = environment.isLuminanceReduced ? '#FFFFFF' : '#3DDC97';
  const muted = '#9AA7B5';
  const start = new Date(content.startedAt);
  // iOS ends a Live Activity after 8 h; that is also the count-up timer's upper bound whenever
  // nothing sooner applies (the checkout minimum, or a routine's current rest period).
  const timerEnd = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  // Must stay INSIDE this function, not at module scope: the 'widget' directive only serializes
  // the function body for the extension's own JS runtime to evaluate later — a module-scope value
  // like this one used to be (regression introduced when this file was restructured for routine
  // mode) is simply undefined there, silently breaking every frame() that referenced it, in BOTH
  // modes. Confirmed against Expo's own docs: "the bundler serializes only the function body, so
  // module-scope values are not present at runtime."
  const wide = 10000; // stands in for "as wide as the parent allows" (JSON cannot carry Infinity)

  const resting = content.kind === 'routine' && content.restEndAt !== null;

  const topLabel = content.kind === 'checkout' ? content.groupLabel : content.routineName;
  const buttonLabel = content.kind === 'checkout' ? 'Tomar Foto Final' : resting ? 'Saltar Descanso' : 'Abrir Entreno';
  const buttonUrl =
    content.kind === 'checkout' ? content.checkoutUrl : resting ? content.skipRestUrl : content.kind === 'routine' ? content.openUrl : '';
  // The big clock: counts UP from `start` normally, or DOWN to a nearer deadline when one applies
  // (the checkout minimum's own countdown is a separate row below it — this only ever switches to
  // counting down for a routine's rest period).
  const bigClockUpper = content.kind === 'routine' && resting ? new Date(content.restEndAt as string) : timerEnd;
  const bigClockCountsDown = content.kind === 'routine' && resting;
  // Checkout mode's time-based minimum-reached bar + its own "time remaining" row.
  const hasMinimumBar = content.kind === 'checkout' && content.minMinutes > 0;
  const minimumEnd =
    content.kind === 'checkout' && content.minMinutes > 0 ? new Date(start.getTime() + content.minMinutes * 60 * 1000) : timerEnd;
  const minimumWidth = content.kind === 'checkout' && content.minMinutes >= 60 ? 58 : 44; // "44:59" under an hour, "1:14:59" from an hour up
  // Routine mode's fraction-based sets-completed bar + its plain "x/y series" label.
  const hasSetsBar = content.kind === 'routine' && content.totalSets > 0;
  const setsFraction = content.kind === 'routine' && content.totalSets > 0 ? content.completedSets / content.totalSets : 0;
  const setsLabel = content.kind === 'routine' ? `${content.completedSets}/${content.totalSets} series` : '';

  return {
    banner: (
      <VStack spacing={4} modifiers={[padding({ horizontal: 24, vertical: 12 })]}>
        <HStack>
          <Text modifiers={[font({ weight: 'bold', size: 13 }), foregroundStyle(green)]}>Gym Buddies</Text>
          <Spacer />
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{topLabel}</Text>
        </HStack>
        <Text
          timerInterval={{ lower: start, upper: bigClockUpper }}
          countsDown={bigClockCountsDown}
          modifiers={[
            font({ weight: 'bold', size: 34 }),
            monospacedDigit(),
            multilineTextAlignment('center'),
            frame({ maxWidth: wide, alignment: 'center' }),
          ]}
        />
        {hasMinimumBar ? (
          <VStack spacing={4}>
            <ProgressView
              timerInterval={{ lower: start, upper: minimumEnd }}
              countsDown={false}
              modifiers={[tint(green), labelsHidden()]}
            />
            <HStack spacing={4}>
              <Spacer />
              <Text modifiers={[font({ size: 13 })]}>Tiempo mínimo restante:</Text>
              <Text
                timerInterval={{ lower: start, upper: minimumEnd }}
                countsDown
                modifiers={[
                  font({ weight: 'semibold', size: 13 }),
                  monospacedDigit(),
                  multilineTextAlignment('leading'),
                  frame({ width: minimumWidth, alignment: 'leading' }),
                ]}
              />
              <Spacer />
            </HStack>
          </VStack>
        ) : null}
        {hasSetsBar ? (
          <VStack spacing={4}>
            <ProgressView value={setsFraction} modifiers={[tint(green), labelsHidden()]} />
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(muted),
                multilineTextAlignment('center'),
                frame({ maxWidth: wide, alignment: 'center' }),
              ]}
            >
              {setsLabel}
            </Text>
          </VStack>
        ) : null}
        <HStack>
          <Spacer />
          <Link label={buttonLabel} destination={buttonUrl} modifiers={[font({ weight: 'semibold', size: 15 }), foregroundStyle(green)]} />
          <Spacer />
        </HStack>
      </VStack>
    ),
    // Compact island: two small pieces either side of the camera cut-out. The width of the whole
    // pill is the sum of the two, so the clock gets a fixed width instead of stretching.
    compactLeading: (
      <Text modifiers={[font({ weight: 'bold', size: 13 }), foregroundStyle(green), padding({ leading: 10 })]}>GB</Text>
    ),
    compactTrailing: (
      <Text
        timerInterval={{ lower: start, upper: bigClockUpper }}
        countsDown={bigClockCountsDown}
        modifiers={[
          font({ weight: 'semibold', size: 13 }),
          monospacedDigit(),
          minimumScaleFactor(0.7),
          multilineTextAlignment('trailing'),
          frame({ width: 50, alignment: 'trailing' }),
          padding({ trailing: 4 }),
        ]}
      />
    ),
    minimal: <Text modifiers={[font({ weight: 'bold', size: 13 }), foregroundStyle(green)]}>GB</Text>,
    expandedLeading: (
      <VStack modifiers={[padding({ all: 14 })]}>
        <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(green)]}>Gym Buddies</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{topLabel}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 14 })]}>
        <Text
          timerInterval={{ lower: start, upper: bigClockUpper }}
          countsDown={bigClockCountsDown}
          modifiers={[
            font({ weight: 'bold', size: 22 }),
            monospacedDigit(),
            multilineTextAlignment('trailing'),
            frame({ width: 96, alignment: 'trailing' }),
          ]}
        />
      </VStack>
    ),
    expandedBottom: (
      <VStack spacing={10} modifiers={[padding({ horizontal: 20, vertical: 12 })]}>
        {hasMinimumBar ? (
          <ProgressView
            timerInterval={{ lower: start, upper: minimumEnd }}
            countsDown={false}
            modifiers={[tint(green), labelsHidden()]}
          />
        ) : null}
        {hasSetsBar ? (
          <VStack spacing={4}>
            <ProgressView value={setsFraction} modifiers={[tint(green), labelsHidden()]} />
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(muted),
                multilineTextAlignment('center'),
                frame({ maxWidth: wide, alignment: 'center' }),
              ]}
            >
              {setsLabel}
            </Text>
          </VStack>
        ) : null}
        <HStack>
          <Spacer />
          <Link label={buttonLabel} destination={buttonUrl} modifiers={[font({ weight: 'semibold', size: 16 }), foregroundStyle(green)]} />
          <Spacer />
        </HStack>
      </VStack>
    ),
  };
};

export default createLiveActivity('WorkoutActivity', WorkoutActivity);
