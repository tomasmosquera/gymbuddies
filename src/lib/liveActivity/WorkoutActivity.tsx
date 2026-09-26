import { HStack, Link, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { WorkoutActivityProps } from '@/lib/domain/workoutActivity';

/**
 * The workout timer shown on the lock screen and in the Dynamic Island from the check-in photo
 * until the final one. Everything inside a 'widget' component runs in the widget's own isolated
 * runtime: only @expo/ui/swift-ui components, no hooks, no app state, no async work — so it
 * cannot import from the rest of the app at runtime: only a type is imported (it erases), and the
 * deep link for the button arrives inside the props (`checkoutUrl`).
 *
 * The clocks are drawn by the system (`timerInterval`), so they keep ticking with the app closed
 * and need no updates or pushes. A SwiftUI timer text is greedy — it stretches to whatever width
 * it is offered — so every one of them is given an explicit frame: a fixed width where it sits
 * next to other things, a very wide frame plus centered alignment where it should be centered.
 */
const WorkoutActivity = (props: WorkoutActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const green = environment.isLuminanceReduced ? '#FFFFFF' : '#3DDC97';
  const muted = '#9AA7B5';
  const start = new Date(props.startedAt);
  // iOS ends a Live Activity after 8 h; that is also the count-up timer's upper bound.
  const timerEnd = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  const minEnd = new Date(start.getTime() + props.minMinutes * 60 * 1000);
  const hasMinimum = props.minMinutes > 0;
  // "44:59" while the minimum is under an hour, "1:14:59" from an hour up.
  const remainingWidth = props.minMinutes >= 60 ? 62 : 48;
  const wide = 10000; // stands in for "as wide as the parent allows" (JSON cannot carry Infinity)

  return {
    banner: (
      <VStack spacing={12} modifiers={[padding({ horizontal: 24, vertical: 20 })]}>
        <HStack>
          <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(green)]}>Gym Buddies</Text>
          <Spacer />
          <Text modifiers={[font({ size: 13 }), foregroundStyle(muted)]}>{props.groupName}</Text>
        </HStack>
        <Text
          timerInterval={{ lower: start, upper: timerEnd }}
          countsDown={false}
          modifiers={[
            font({ weight: 'bold', size: 44 }),
            monospacedDigit(),
            multilineTextAlignment('center'),
            frame({ maxWidth: wide, alignment: 'center' }),
          ]}
        />
        {hasMinimum ? (
          <VStack spacing={8}>
            <ProgressView timerInterval={{ lower: start, upper: minEnd }} modifiers={[tint(green)]} />
            <HStack spacing={4}>
              <Spacer />
              <Text modifiers={[font({ size: 14 })]}>Tiempo mínimo restante:</Text>
              <Text
                timerInterval={{ lower: start, upper: minEnd }}
                countsDown
                modifiers={[
                  font({ weight: 'semibold', size: 14 }),
                  monospacedDigit(),
                  multilineTextAlignment('leading'),
                  frame({ width: remainingWidth, alignment: 'leading' }),
                ]}
              />
              <Spacer />
            </HStack>
          </VStack>
        ) : null}
        <HStack>
          <Spacer />
          <Link
            label="Tomar Foto Final"
            destination={props.checkoutUrl}
            modifiers={[font({ weight: 'semibold', size: 16 }), foregroundStyle(green)]}
          />
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
        timerInterval={{ lower: start, upper: timerEnd }}
        countsDown={false}
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
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{props.groupName}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 14 })]}>
        <Text
          timerInterval={{ lower: start, upper: timerEnd }}
          countsDown={false}
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
        {hasMinimum ? <ProgressView timerInterval={{ lower: start, upper: minEnd }} modifiers={[tint(green)]} /> : null}
        <HStack>
          <Spacer />
          <Link
            label="Tomar Foto Final"
            destination={props.checkoutUrl}
            modifiers={[font({ weight: 'semibold', size: 16 }), foregroundStyle(green)]}
          />
          <Spacer />
        </HStack>
      </VStack>
    ),
  };
};

export default createLiveActivity('WorkoutActivity', WorkoutActivity);
