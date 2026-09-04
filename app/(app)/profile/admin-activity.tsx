import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { ActivityRow } from '@/components/admin/ActivityRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupActivityFeed } from '@/hooks/useGroupActivityFeed';
import { colors, spacing } from '@/constants/theme';

const PAGE_SIZE = 20;

/** Full "Actividad reciente" list — the group admin panel's inline preview
 * shows the first 10 with a "Ver más" link into this screen, which loads 20
 * at a time and fetches another 20 as the list nears its end. */
export default function AdminActivityScreen() {
  const { session } = useAuth();
  const { group } = useActiveGroup();
  const { items, isLoading, isLoadingMore, refresh, loadMore } = useGroupActivityFeed(
    group?.id ?? null,
    session?.user.id ?? null,
    PAGE_SIZE
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- only on focus, not on every refresh identity change (its own deps already cover group/user changes).
    }, [])
  );

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
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => <ActivityRow notification={item} isFirst={index === 0} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={
        <EmptyState title="Sin actividad" description="Todavía no hay actividad reciente en este grupo." />
      }
      ListFooterComponent={isLoadingMore ? <ActivityIndicator color={colors.primary} style={styles.footerSpinner} /> : null}
      style={styles.card}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, backgroundColor: colors.background },
  card: { backgroundColor: colors.background },
  footerSpinner: { marginVertical: spacing.md },
});
