import { CooklogColors } from '@/constants/cooklogTheme';
import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_BAR_EXTRA = 72;

type Props = PropsWithChildren<{
  /** Padding extra sotto per tab bar e home indicator. */
  bottomInset?: number;
}>;

export function ScreenScroll({ children, bottomInset }: Props) {
  const insets = useSafeAreaInsets();
  const bottom = bottomInset ?? insets.bottom + TAB_BAR_EXTRA;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: bottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: CooklogColors.background,
  },
  content: {
    flexGrow: 1,
  },
});
