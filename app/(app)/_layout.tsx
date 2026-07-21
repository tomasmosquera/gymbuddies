import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { colors } from '@/constants/theme';

function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{symbol}</Text>;
}

export default function AppLayout() {
  const { isInitializing, isSignedIn } = useAuth();
  const { membership, isLoading } = useActiveGroup();

  if (isInitializing || isLoading) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  if (!membership) return <Redirect href="/create-group" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Inicio', tabBarIcon: ({ focused }) => <TabIcon symbol="🏠" focused={focused} /> }}
      />
      <Tabs.Screen
        name="checkin"
        options={{ title: 'Check-in', tabBarIcon: ({ focused }) => <TabIcon symbol="📸" focused={focused} /> }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Dashboard', tabBarIcon: ({ focused }) => <TabIcon symbol="📊" focused={focused} /> }}
      />
      <Tabs.Screen
        name="rules"
        options={{ title: 'Reglas', tabBarIcon: ({ focused }) => <TabIcon symbol="🗳️" focused={focused} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Perfil', tabBarIcon: ({ focused }) => <TabIcon symbol="👤" focused={focused} /> }}
      />
    </Tabs>
  );
}
