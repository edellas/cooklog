import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TabBar, type Tab } from './src/components/TabBar';
import { getMe } from './src/services/api';
import { ArenaScreen } from './src/screens/ArenaScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { PublishScreen } from './src/screens/PublishScreen';
import { RulesModal } from './src/screens/RulesModal';
import { TodayScreen } from './src/screens/TodayScreen';
import { colors } from './src/theme';
import type { DailyViral, Me } from './src/types';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/* Su web/tablet l'app resta larga come un telefono, centrata. */}
      <View style={styles.outer}>
        <View style={styles.frame}>
          <Root />
        </View>
      </View>
    </SafeAreaProvider>
  );
}

function Root() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('today');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [celebration, setCelebration] = useState<{ viral: DailyViral | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  if (me === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!me) {
    return (
      <OnboardingScreen
        onDone={(next) => {
          setMe(next);
          setShowRules(false);
        }}
      />
    );
  }

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <View style={styles.root}>
      <View style={styles.screen}>
        {tab === 'today' ? <TodayScreen me={me} refreshKey={refreshKey} onOpenRules={() => setShowRules(true)} onGoArena={() => setTab('arena')} /> : null}
        {tab === 'arena' ? (
          <ArenaScreen
            onPublish={() => setTab('publish')}
            onDayClosed={(viral) => {
              refresh();
              setCelebration({ viral });
            }}
          />
        ) : null}
        {tab === 'publish' ? (
          <PublishScreen
            me={me}
            onPublished={(_, joined) => {
              refresh();
              setToast(joined ? '🔥 Sei in gara! Il tuo contenuto parte dal livello 1.' : 'Pubblicato.');
              setTab(joined ? 'arena' : 'profile');
            }}
          />
        ) : null}
        {tab === 'profile' ? (
          <ProfileScreen
            me={me}
            refreshKey={refreshKey}
            onOpenRules={() => setShowRules(true)}
            onReset={() => {
              setMe(null);
              setTab('today');
            }}
          />
        ) : null}
        {toast ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
      </View>
      <TabBar current={tab} onChange={setTab} />

      <RulesModal visible={showRules} onClose={() => setShowRules(false)} />
      <Modal visible={Boolean(celebration)} transparent animationType="fade" onRequestClose={() => setCelebration(null)}>
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            {celebration?.viral ? (
              <>
                <Text style={styles.big}>{celebration.viral.post.authorId === me.id ? '🏆' : '🔥'}</Text>
                <Text style={styles.dialogTitle}>
                  {celebration.viral.post.authorId === me.id ? 'Hai vinto tu!' : `Vince @${celebration.viral.post.authorUsername}`}
                </Text>
                <Text style={styles.dialogText}>
                  Su {celebration.viral.totalEntries} contenuti in gara. Da adesso è la prima cosa che vede chiunque apra l’app.
                  {'\n\n'}È appena partita una nuova gara.
                </Text>
              </>
            ) : (
              <Text style={styles.dialogTitle}>Nessun vincitore idoneo oggi.</Text>
            )}
            <Pressable
              style={styles.dialogButton}
              onPress={() => {
                setCelebration(null);
                setTab('today');
              }}>
              <Text style={styles.dialogButtonText}>Guarda il virale di oggi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: '#050505', alignItems: 'center' },
  frame: { flex: 1, width: '100%', maxWidth: 480, backgroundColor: colors.bg, overflow: 'hidden' },
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  toast: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(30,30,30,0.95)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toastText: { color: '#FFF', fontWeight: '700', textAlign: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, gap: 10, alignItems: 'center', width: '100%', maxWidth: 400 },
  big: { fontSize: 56 },
  dialogTitle: { color: '#FFF', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  dialogText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  dialogButton: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 18, marginTop: 6 },
  dialogButtonText: { color: '#FFF', fontWeight: '900' },
});
