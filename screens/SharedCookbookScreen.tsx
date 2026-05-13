import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MEMBERS = [
  { name: 'Nonna Lucia', role: 'Curatrice' },
  { name: 'Marco Rossi', role: 'Collaboratore' },
  { name: 'Sara Bianchi', role: 'Lettura sola' },
];

const SHARED_RECIPES = [
  { title: 'Ragù della domenica', note: 'Versione familiare, cottura lunga.' },
  { title: 'Torta di mele', note: 'Con cannella leggera e zucchero di canna.' },
  { title: 'Focaccia morbida', note: 'Impasto lievitato 24 ore in frigo.' },
];

export function SharedCookbookScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
      showsVerticalScrollIndicator={false}>
      <View style={styles.pad}>
        <Text style={styles.title}>Ricette di famiglia</Text>
        <Text style={styles.sub}>
          Ricettario condiviso mock: nessun backend, dati solo dimostrativi.
        </Text>

        <View style={styles.actions}>
          <Pressable
            onPress={() => Alert.alert('Invita', 'Invito inviato (simulazione).')}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryLabel}>Invita qualcuno</Text>
          </Pressable>
          <Pressable
            onPress={() => Alert.alert('Link', 'Link copiato (simulazione).')}
            style={({ pressed }) => [styles.outline, pressed && styles.pressed]}>
            <Text style={styles.outlineLabel}>Condividi link</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Membri</Text>
        {MEMBERS.map((m) => (
          <View key={m.name} style={styles.member}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{m.name.charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{m.name}</Text>
              <Text style={styles.memberRole}>{m.role}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.section}>Ricette condivise</Text>
        {SHARED_RECIPES.map((r) => (
          <View key={r.title} style={styles.recipe}>
            <Text style={styles.recipeTitle}>{r.title}</Text>
            <Text style={styles.recipeNote}>{r.note}</Text>
          </View>
        ))}

        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>Torna indietro</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: CooklogColors.background,
  },
  pad: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    paddingTop: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: CooklogColors.text,
    letterSpacing: -0.4,
  },
  sub: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: CooklogColors.textMuted,
  },
  actions: {
    marginTop: 20,
    gap: 10,
  },
  primary: {
    backgroundColor: CooklogColors.primary,
    borderRadius: CooklogRadii.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: CooklogColors.backgroundElevated,
  },
  outline: {
    borderRadius: CooklogRadii.button,
    borderWidth: 1,
    borderColor: CooklogColors.primary,
    paddingVertical: 14,
    alignItems: 'center',
  },
  outlineLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: CooklogColors.primary,
  },
  pressed: {
    opacity: 0.92,
  },
  section: {
    marginTop: 28,
    marginBottom: 12,
    fontSize: 18,
    fontWeight: '700',
    color: CooklogColors.text,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CooklogColors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CooklogColors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: CooklogColors.accent,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: CooklogColors.text,
  },
  memberRole: {
    fontSize: 14,
    color: CooklogColors.textMuted,
    marginTop: 2,
  },
  recipe: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CooklogColors.border,
  },
  recipeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: CooklogColors.text,
  },
  recipeNote: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: CooklogColors.textMuted,
  },
  back: {
    marginTop: 28,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  backLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: CooklogColors.accent,
  },
});
