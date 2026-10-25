import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingTabBar, TabBarInsetProvider, tabBarInsetFor } from '@/components/FloatingTabBar';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <TabBarInsetProvider value={tabBarInsetFor(insets.bottom)}>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.background } }}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="track" options={{ title: 'Track' }} />
        <Tabs.Screen name="history" options={{ title: 'History' }} />
        <Tabs.Screen name="statistics" options={{ title: 'Statistics' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </TabBarInsetProvider>
  );
}
