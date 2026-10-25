import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { createContext, useContext } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTrackingSnapshot } from '@/hooks/useTracking';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

const TABS: Record<string, { label: string; icon: IconName; activeIcon: IconName }> = {
  index: { label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  track: { label: 'Track', icon: 'play', activeIcon: 'play' },
  history: { label: 'History', icon: 'history', activeIcon: 'history' },
  statistics: { label: 'Statistics', icon: 'chart-box-outline', activeIcon: 'chart-box' },
  settings: { label: 'Settings', icon: 'cog-outline', activeIcon: 'cog' },
};

const BAR_HEIGHT = 64;
const BAR_GAP = 12;

/** Space a tab screen leaves at the bottom so its last content scrolls clear of the floating bar. */
const TabBarInsetContext = createContext(0);
export const TabBarInsetProvider = TabBarInsetContext.Provider;

export function useTabBarInset(): number {
  return useContext(TabBarInsetContext);
}

/** Bottom inset for tab screens: bar + its gap above the gesture area + breathing room. */
export function tabBarInsetFor(bottomSafeArea: number): number {
  return bottomSafeArea + BAR_GAP + BAR_HEIGHT + Spacing.lg;
}

/**
 * The floating glass navigation pill. Track is always drawn in the accent colour (it is the main
 * action), so the selected tab also gets a tinted pill; a dot on Track marks a workout in progress.
 */
export function FloatingTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tracking = useTrackingSnapshot();
  const live = tracking.activityId !== null;

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom: insets.bottom + BAR_GAP }]}>
      <View
        accessibilityRole="tablist"
        style={[styles.bar, { backgroundColor: theme.glass, borderColor: theme.border, boxShadow: `0px 12px 32px ${theme.shadow}` }]}>
        {state.routes.map((route, index) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === index;
          const isTrack = route.name === 'track';
          const color = focused || isTrack ? theme.accent : theme.textMuted;
          const onPress = () => {
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigateToTab(route.key);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={isTrack && live ? `${tab.label}, workout in progress` : tab.label}
              style={styles.item}>
              <View style={[styles.iconPill, focused ? { backgroundColor: theme.successSurface } : null]}>
                <Icon name={focused ? tab.activeIcon : tab.icon} size={24} color={color} />
                {isTrack && live ? (
                  <View
                    style={[
                      styles.liveDot,
                      { backgroundColor: tracking.activityType === 'run' ? theme.run : theme.walk, borderColor: theme.surface },
                    ]}
                  />
                ) : null}
              </View>
              <AppText variant="label" tint={color} weight={focused ? '700' : '600'} style={styles.label} numberOfLines={1}>
                {tab.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: Spacing.lg, right: Spacing.lg },
  bar: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.xs,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: '100%' },
  iconPill: { width: 48, height: 30, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  liveDot: { position: 'absolute', top: 2, right: 8, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  label: { fontSize: 10, lineHeight: 13, letterSpacing: 0.3 },
});
