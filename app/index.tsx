import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useMyMemberships } from '@/hooks/useMyMemberships';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { usePendingInviteStore } from '@/state/pendingInviteStore';
import { colors } from '@/constants/theme';

export default function Index() {
  const { isInitializing, isSignedIn } = useAuth();
  const { memberships, isLoading: membershipsLoading } = useMyMemberships();
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const pendingCode = usePendingInviteStore((s) => s.pendingCode);
  const setPendingCode = usePendingInviteStore((s) => s.setPendingCode);

  const activeMembership = memberships.find((m) => m.group_id === activeGroupId) ?? memberships[0];

  useEffect(() => {
    if (!membershipsLoading && activeMembership && activeMembership.group_id !== activeGroupId) {
      setActiveGroupId(activeMembership.group_id);
    }
  }, [membershipsLoading, activeMembership, activeGroupId, setActiveGroupId]);

  // One-shot: a pending invite (from a deferred deep link, or from opening
  // /join/[code] while signed out) gets exactly one redirect here, right
  // after sign-up/sign-in completes — then it's cleared so backing out of
  // that screen doesn't keep bouncing the user back to it.
  useEffect(() => {
    if (!membershipsLoading && !activeMembership && pendingCode) {
      setPendingCode(null);
    }
  }, [membershipsLoading, activeMembership, pendingCode, setPendingCode]);

  if (isInitializing || (isSignedIn && membershipsLoading)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  if (!activeMembership) {
    if (pendingCode) {
      return <Redirect href={{ pathname: '/join/[code]', params: { code: pendingCode } }} />;
    }
    return <Redirect href="/group-select" />;
  }

  return <Redirect href="/home" />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
