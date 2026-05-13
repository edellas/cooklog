import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { useAuth } from '@/src/providers/AuthProvider';
import { getSubscriptionStatus, upgradeToProMock } from '@/src/services/subscriptionService';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function PaywallScreen() {
  const { user } = useAuth();
  const [plan, setPlan] = useState('free');

  useEffect(() => {
    if (!user) return;
    void getSubscriptionStatus(user.id).then((s) => setPlan(s.plan));
  }, [user]);

  const onUpgrade = async (target: 'pro-monthly' | 'pro-yearly') => {
    if (!user) return;
    await upgradeToProMock(user.id, target);
    setPlan(target);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Cooklog Pro</Text>
      <Text style={styles.sub}>Sblocca funzioni avanzate con un upgrade mock.</Text>
      <Feature text="Generazioni AI illimitate" />
      <Feature text="Ricette salvate illimitate" />
      <Feature text="Ricettari condivisi futuri" />
      <Feature text="Export PDF futuro" />
      <Feature text="Backup cloud avanzato futuro" />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>2,99€/mese</Text>
        <Pressable onPress={() => void onUpgrade('pro-monthly')} style={styles.button}>
          <Text style={styles.buttonLabel}>Attiva Pro Mensile (mock)</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>19,99€/anno</Text>
        <Pressable onPress={() => void onUpgrade('pro-yearly')} style={styles.button}>
          <Text style={styles.buttonLabel}>Attiva Pro Annuale (mock)</Text>
        </Pressable>
      </View>
      <Text style={styles.current}>Piano attuale: {plan}</Text>
    </ScrollView>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <View style={styles.feature}>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background },
  content: { padding: CooklogSpacing.screenHorizontal, paddingBottom: 80, gap: 10 },
  title: { marginTop: 12, fontSize: 30, fontWeight: '700', color: CooklogColors.text },
  sub: { color: CooklogColors.textMuted, marginBottom: 10 },
  feature: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: CooklogColors.surface,
  },
  featureText: { color: CooklogColors.text },
  card: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: CooklogRadii.card,
    backgroundColor: CooklogColors.surface,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontSize: 22, fontWeight: '700', color: CooklogColors.text },
  button: {
    borderRadius: 10,
    backgroundColor: CooklogColors.primary,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonLabel: { color: '#fff', fontWeight: '700' },
  current: { marginTop: 12, color: CooklogColors.textMuted, textAlign: 'center' },
});
