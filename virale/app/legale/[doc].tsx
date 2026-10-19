import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import { Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { color, space } from '../../src/design/tokens';
import { DOCS, type DocSlug } from '../../src/legal/docs';
import { useGoBack } from '../../src/state/useGoBack';

/** Termini, privacy, linee guida, eliminazione account: gli stessi testi pubblicati sul sito. */
export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: DocSlug }>();
  const insets = useSafeAreaInsets();
  const goBack = useGoBack();
  const d = DOCS[doc] ?? DOCS.termini;
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: insets.bottom + space[10], gap: space[5] }}>
        <View style={{ gap: space[2] }}>
          <Txt variant="heading">{d.title}</Txt>
          <Txt variant="body" tone={color.paperDim}>
            {d.intro}
          </Txt>
        </View>
        {d.sections.map((s) => (
          <View key={s.heading} style={{ gap: space[2] }}>
            <Txt variant="title">{s.heading}</Txt>
            {s.body.map((p, i) => (
              <Txt key={i} variant="body" tone={color.paperDim}>
                {p}
              </Txt>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { paddingHorizontal: space[4], paddingVertical: space[2] },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
});
