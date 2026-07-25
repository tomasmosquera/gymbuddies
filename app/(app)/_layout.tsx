import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { colors } from '@/constants/theme';

function TabIcon({
  filled,
  outline,
  focused,
  color,
}: {
  filled: keyof typeof Ionicons.glyphMap;
  outline: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  color: string;
}) {
  return <Ionicons name={focused ? filled : outline} size={24} color={color} />;
}

export default function AppLayout() {
  const { isInitializing, isSignedIn } = useAuth();
  const { membership, isLoading } = useActiveGroup();

  if (isInitializing || isLoading) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  if (!membership) return <Redirect href="/group-select" />;

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
        options={{
          title: 'Inicio',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon filled="home" outline="home-outline" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="checkin"
        options={{
          title: 'Check-in',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon filled="camera" outline="camera-outline" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon filled="stats-chart" outline="stats-chart-outline" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rules"
        options={{
          title: 'Reglas',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon filled="clipboard" outline="clipboard-outline" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon filled="person" outline="person-outline" focused={focused} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
