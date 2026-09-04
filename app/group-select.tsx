import { useLayoutEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useMyMemberships, type MembershipWithGroup } from '@/hooks/useMyMemberships';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { colors, spacing, typography } from '@/constants/theme';

const PLATFORM_ADMIN_EMAIL = 'tomasmosquera@hotmail.com';

export default function GroupSelectScreen() {
  const { memberships, isLoading } = useMyMemberships();
  const { session, profile, isInitializing, isSignedIn, signOut } = useAuth();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const navigation = useNavigation();

  // group-select is reached two very different ways: Profile > "Cambiar de
  // grupo" (pushed with ?from=switch — there's a real Home to pop back to)
  // or a cold-start redirect chain ((auth) → "/" → group-select once signed
  // in with zero memberships — nothing sensible behind it, and going "back"
  // would just bounce off (auth)'s own already-signed-in redirect and land
  // right back here). This used to be decided via router.canGoBack() from a
  // headerLeft defined in the root layout, but that reported a false
  // positive in the cold-start case (the redirect chain leaves a stale
  // /sign-in entry underneath) — hence a back button that visibly did
  // nothing. Deciding it here instead, from the screen that's actually
  // mounted with its own real params, and pushing it into the header via
  // setOptions — same fix shape as WalletBackButton in profile/_layout.tsx,
  // just keyed off an explicit param instead of history depth.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft:
        from === 'switch'
          ? () => (
              <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
                <Ionicons name="chevron-back" size={26} color={colors.text} />
              </Pressable>
            )
          : () => null,
    });
  }, [from, navigation]);
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const isPlatformAdmin = session?.user.email === PLATFORM_ADMIN_EMAIL;
  const credits = profile?.group_creation_credits ?? 0;
  const canCreateGroup = isPlatformAdmin || credits > 0;

  // group-select is a root-level screen, outside the (app) stack — so unlike
  // Profile's own "Cerrar sesión" (which lives inside (app)/_layout.tsx and
  // gets redirected to /sign-in the moment isSignedIn flips false), nothing
  // was watching for that here. signOut() itself worked fine, it just left
  // this screen sitting there with a now-null profile (hence "credits" and
  // the no-credits hint appearing to flicker) until the app was relaunched.
  if (!isInitializing && !isSignedIn) return <Redirect href="/sign-in" />;

  const handleSelect = (membership: MembershipWithGroup) => {
    setActiveGroupId(membership.group_id);
    if (membership.status === 'pending_deposit') {
      router.replace('/deposit');
    } else {
      router.replace('/home');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={memberships}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        memberships.length === 0 ? (
          <View style={styles.welcome}>
            <Text style={styles.welcomeTitle}>¡Bienvenido a Gym Buddies! 💪</Text>
            <Text style={styles.welcomeText}>
              Todavía no perteneces a ningún grupo. Crea uno nuevo o únete a uno existente con un código de
              invitación.
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => handleSelect(item)}>
          <Card style={[styles.row, item.group_id === activeGroupId && styles.rowActive]}>
            <View>
              <Text style={styles.groupName}>{item.group.name}</Text>
              <Text style={styles.role}>{item.role === 'admin' ? 'Administrador' : 'Miembro'}</Text>
            </View>
            {item.status === 'pending_deposit' ? <Badge label="Falta depósito" tone="warning" /> : null}
            {item.status === 'needs_recharge' ? <Badge label="Necesita recarga" tone="danger" /> : null}
            {item.status === 'admin_only' ? <Badge label="Solo administras" /> : null}
          </Card>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      ListFooterComponent={
        <View style={styles.footer}>
          <Text style={styles.creditsText}>
            {isPlatformAdmin ? 'Créditos ilimitados (admin de la plataforma)' : `Créditos disponibles: ${credits}`}
          </Text>
          <Button
            label={memberships.length === 0 ? 'Crear un grupo nuevo' : 'Crear otro grupo'}
            variant="secondary"
            onPress={() => router.push('/create-group')}
            disabled={!canCreateGroup}
          />
          {!canCreateGroup ? (
            <Text style={styles.creditsHint}>
              No te quedan créditos para crear un grupo — contacta al administrador de la app.
            </Text>
          ) : null}
          <Button label="Unirme con un código" variant="secondary" onPress={() => router.push('/join-group')} />
          <Button
            label="Unirme a un grupo público"
            variant="secondary"
            onPress={() => router.push('/browse-public-groups')}
          />
          <View style={styles.signOutSection}>
            <Button label="Cerrar sesión" variant="secondary" onPress={() => signOut()} />
          </View>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowActive: { borderColor: colors.primary },
  groupName: { color: colors.text, fontWeight: '700', fontSize: 16 },
  role: { color: colors.textMuted, marginTop: 2 },
  footer: { gap: spacing.sm, marginTop: spacing.lg },
  creditsText: { color: colors.primary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  creditsHint: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  welcome: { gap: spacing.sm, marginBottom: spacing.lg },
  welcomeTitle: { ...typography.title, fontSize: 22, color: colors.text },
  welcomeText: { color: colors.textMuted, fontSize: 15 },
  signOutSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceAlt,
  },
});
