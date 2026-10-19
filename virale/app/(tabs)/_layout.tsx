import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { Icon, type IconName } from '../../src/components/Icon';
import { Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { useSession } from '../../src/state/session';
import { color, radius } from '../../src/design/tokens';
import { useNav } from '../../src/state/nav';

const ITEMS: Record<string, { icon: IconName; label: string }> = {
  index: { icon: 'copertina', label: 'Copertina' },
  provini: { icon: 'provini', label: 'Provini' },
  archivio: { icon: 'archivio', label: 'Archivio' },
  profilo: { icon: 'profilo', label: 'Profilo' },
};

export default function TabsLayout() {
  return (
    // I tab sono pari grado: nessuna animazione nel passaggio (usati decine di volte al giorno).
    <Tabs screenOptions={{ headerShown: false, animation: 'none', sceneStyle: { backgroundColor: color.canvas } }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="provini" />
      <Tabs.Screen name="archivio" />
      <Tabs.Screen name="profilo" />
    </Tabs>
  );
}

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const { status } = useSession();
  const unread = status?.unread ?? 0;
  const routes = state.routes;
  const item = (i: number) => {
    const route = routes[i];
    const meta = ITEMS[route.name];
    const focused = state.index === i;
    return (
      <Press
        key={route.key}
        style={styles.item}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={route.name === 'profilo' && unread ? `${meta.label}, ${unread === 1 ? '1 notifica' : `${unread} notifiche`} da leggere` : meta.label}>
        <View>
          <Icon name={meta.icon} size={24} color={focused ? color.paper : color.paperFaint} strokeWidth={focused ? 2 : 1.75} />
          {route.name === 'profilo' && unread ? <View style={styles.dot} /> : null}
        </View>
        <Txt variant="meta" tone={focused ? color.paper : color.paperFaint} style={{ fontSize: 11 }}>
          {meta.label}
        </Txt>
      </Press>
    );
  };
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {item(0)}
      {item(1)}
      <Press style={styles.item} onPress={() => nav.push('/scatta')} hapticOnPress="light" accessibilityRole="button" accessibilityLabel="Nuovo post">
        <View style={styles.create}>
          <Icon name="scatta" size={22} color={color.canvas} strokeWidth={2.4} />
        </View>
      </Press>
      {item(2)}
      {item(3)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: 'center', gap: 3, minHeight: 44, justifyContent: 'center' },
  dot: { position: 'absolute', top: -1, right: -3, width: 9, height: 9, borderRadius: 5, backgroundColor: color.matita, borderWidth: 1.5, borderColor: color.canvas },
  create: {
    width: 52,
    height: 36,
    borderRadius: radius.control,
    backgroundColor: color.giallo,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
