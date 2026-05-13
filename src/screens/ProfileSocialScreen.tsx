import { ProUpgradeCard } from '@/components/cooklog/ProUpgradeCard';
import { ScreenScroll } from '@/components/cooklog/ScreenScroll';
import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getSubscriptionStatus } from '@/src/services/subscriptionService';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ProfileSocialScreen() {
  const router = useRouter();
  const { profile, interests, logout, user } = useAuth();
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    void getSubscriptionStatus(user.id).then((s) => setSavedCount(s.savedRecipesCount));
  }, [user]);

  return (
    <ScreenScroll>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(profile?.displayName ?? 'U').charAt(0)}</Text>
        </View>
        <Text style={styles.name}>{profile?.displayName ?? 'Utente'}</Text>
        <Text style={styles.handle}>@{profile?.username ?? 'utente'}</Text>
        <Text style={styles.bio}>{profile?.bio ?? 'Aggiungi una bio dal tuo profilo.'}</Text>
      </View>
      <View style={styles.stats}>
        <Stat title="Post" value="12" />
        <Stat title="Salvate" value={String(savedCount)} />
        <Stat title="Interessi" value={String(interests.length)} />
      </View>

      <View style={styles.chips}>
        {interests.map((interest) => (
          <View key={interest} style={styles.chip}>
            <Text style={styles.chipText}>{interest}</Text>
          </View>
        ))}
      </View>

      <View style={styles.block}>
        <Pressable onPress={() => router.push('/edit-profile' as Href)} style={styles.action}>
          <Text style={styles.actionText}>Modifica profilo</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/paywall' as Href)} style={styles.action}>
          <Text style={styles.actionText}>Cooklog Pro</Text>
        </Pressable>
        <Pressable onPress={() => void logout()} style={[styles.action, styles.logout]}>
          <Text style={[styles.actionText, styles.logoutText]}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.block}>
        <ProUpgradeCard />
      </View>
    </ScreenScroll>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingHorizontal: CooklogSpacing.screenHorizontal, gap: 8 },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CooklogColors.accentSoft,
  },
  avatarText: { fontSize: 24, fontWeight: '700', color: CooklogColors.accent },
  name: { fontSize: 24, fontWeight: '700', color: CooklogColors.text },
  handle: { color: CooklogColors.textMuted, fontWeight: '500' },
  bio: { color: CooklogColors.textMuted, textAlign: 'center' },
  stats: {
    marginTop: 12,
    marginHorizontal: CooklogSpacing.screenHorizontal,
    borderRadius: CooklogRadii.card,
    borderColor: CooklogColors.border,
    borderWidth: 1,
    backgroundColor: CooklogColors.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 20, fontWeight: '700', color: CooklogColors.text },
  statTitle: { color: CooklogColors.textMuted },
  chips: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: CooklogSpacing.screenHorizontal,
  },
  chip: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: 20,
    backgroundColor: CooklogColors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: CooklogColors.textMuted, fontWeight: '500' },
  block: { paddingHorizontal: CooklogSpacing.screenHorizontal, marginTop: 16, gap: 10 },
  action: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: CooklogColors.surface,
  },
  actionText: { color: CooklogColors.text, fontWeight: '600' },
  logout: { borderColor: CooklogColors.danger },
  logoutText: { color: CooklogColors.danger },
});
