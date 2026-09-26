import { HStack, Link, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { WorkoutActivityProps } from '@/lib/domain/workoutActivity';

/**
 * The workout timer shown on the lock screen and in the Dynamic Island from the check-in photo
 * until the final one. Everything inside a 'widget' component runs in the widget's own isolated
 * runtime: only @expo/ui/swift-ui components, no hooks, no app state, no async work — so it
 * cannot import from the rest of the app at runtime: only a type is imported (it erases), and the
 * deep link for the button arrives inside the props (`checkoutUrl`).
 *
 * The clock is drawn by the system (`timerInterval`), so it keeps ticking with the app closed and
 * needs no updates or pushes.
 */
const WorkoutActivity = (props: WorkoutActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const url = props.checkoutUrl;
  const start = new Date(props.startedAt);
  // iOS ends a Live Activity after 8 h; that is also the timer's upper bound.
  const timerEnd = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  const minEnd = new Date(start.getTime() + props.minMinutes * 60 * 1000);
  const hasMinimum = props.minMinutes > 0;
  const accent = environment.isLuminanceReduced ? '#FFFFFF' : '#3DDC97';

  return {
    banner: (
      <VStack spacing={8} modifiers={[padding({ all: 14 })]}>
        <HStack>
          <Text modifiers={[font({ weight: 'bold', size: 15 }), foregroundStyle(accent)]}>Gym Buddies</Text>
          <Spacer />
          <Text modifiers={[font({ size: 13 })]}>{props.groupName}</Text>
        </HStack>
        <Text
          timerInterval={{ lower: start, upper: timerEnd }}
          countsDown={false}
          modifiers={[font({ weight: 'bold', size: 34 })]}
        />
        {hasMinimum ? (
          <VStack spacing={4}>
            <ProgressView timerInterval={{ lower: start, upper: minEnd }} />
            <Text modifiers={[font({ size: 12 })]}>{`Mínimo del grupo: ${props.minMinutes} min`}</Text>
          </VStack>
        ) : null}
        <Link label="Tomar foto final" destination={url} />
      </VStack>
    ),
    compactLeading: <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>GB</Text>,
    compactTrailing: <Text timerInterval={{ lower: start, upper: timerEnd }} countsDown={false} />,
    minimal: <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>GB</Text>,
    expandedLeading: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>Gym Buddies</Text>
        <Text modifiers={[font({ size: 12 })]}>{props.groupName}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Text
          timerInterval={{ lower: start, upper: timerEnd }}
          countsDown={false}
          modifiers={[font({ weight: 'bold', size: 22 })]}
        />
      </VStack>
    ),
    expandedBottom: (
      <VStack spacing={6} modifiers={[padding({ all: 12 })]}>
        {hasMinimum ? <ProgressView timerInterval={{ lower: start, upper: minEnd }} /> : null}
        <Link label="Tomar foto final" destination={url} />
      </VStack>
    ),
  };
};

export default createLiveActivity('WorkoutActivity', WorkoutActivity);
