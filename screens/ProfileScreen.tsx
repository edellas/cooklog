import { ProUpgradeCard } from '@/components/cooklog/ProUpgradeCard';
import { ScreenScroll } from '@/components/cooklog/ScreenScroll';
import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { useRecipes } from '@/contexts/RecipeContext';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ProfileScreen() {
  const router = useRouter();
  const { recipes } = useRecipes();
  const favorites = recipes.filter((r) => r.isFavorite).length;

  return (
    <ScreenScroll>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>MR</Text>
        </View>
        <Text style={styles.name}>Marco Rossi</Text>
        <Text style={styles.handle}>Piano Free · account locale</Text>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{recipes.length}</Text>
          <Text style={styles.statLabel}>Ricette salvate</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{favorites}</Text>
          <Text style={styles.statLabel}>Preferite</Text>
        </View>
      </View>

      <View style={styles.block}>
        <ProUpgradeCard />
      </View>

      <Pressable
        onPress={() => router.push('/shared-cookbook')}
        style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}>
        <Text style={styles.linkTitle}>Ricettario condiviso</Text>
        <Text style={styles.linkSub}>Apri la demo “Ricette di famiglia”</Text>
      </Pressable>

      <View style={styles.note}>
        <Text style={styles.noteText}>
          Cooklog è un ricettario privato: nessun feed pubblico in questa fase.
        </Text>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    alignItems: 'center',
    paddingBottom: 8,
    gap: 8,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: CooklogColors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CooklogColors.border,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: CooklogColors.accent,
    letterSpacing: 1,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: CooklogColors.text,
  },
  handle: {
    fontSize: 14,
    color: CooklogColors.textMuted,
  },
  stats: {
    marginHorizontal: CooklogSpacing.screenHorizontal,
    flexDirection: 'row',
    backgroundColor: CooklogColors.surface,
    borderRadius: CooklogRadii.card,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    paddingVertical: 18,
    marginBottom: 20,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: CooklogColors.border,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: CooklogColors.text,
  },
  statLabel: {
    fontSize: 13,
    color: CooklogColors.textMuted,
  },
  block: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    marginBottom: 16,
  },
  linkCard: {
    marginHorizontal: CooklogSpacing.screenHorizontal,
    padding: 18,
    borderRadius: CooklogRadii.card,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    marginBottom: 20,
  },
  linkTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: CooklogColors.text,
  },
  linkSub: {
    marginTop: 6,
    fontSize: 14,
    color: CooklogColors.textMuted,
  },
  note: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    paddingBottom: 8,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
    color: CooklogColors.textSubtle,
  },
  pressed: {
    opacity: 0.92,
  },
});
