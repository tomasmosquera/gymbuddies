import { Image, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { colors } from '@/constants/theme';

export default function HomeStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerTitle: () => (
            <View style={styles.logoWrap}>
              <Image source={require('../../../assets/icon-header.png')} style={styles.logo} resizeMode="contain" />
            </View>
          ),
        }}
      />
      <Stack.Screen name="group-summary" options={{ title: 'Tus grupos' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  logoWrap: { paddingTop: 6 },
  logo: { width: 135, height: 44 },
});
