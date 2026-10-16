import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '../src/components/Toast';
import { Press } from '../src/components/Press';
import { Txt } from '../src/components/Txt';
import { isDemo, logout } from '../src/services/api';
import { OWNER } from '../src/legal/docs';
import { flushViews } from '../src/state/views';
import { FONTS } from '../src/design/fonts';
import { color } from '../src/design/tokens';
import { SessionProvider, useSession } from '../src/state/session';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Aperta da un link (una copertina, un post), l'app ha comunque i tab sotto: "indietro" porta lì.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONTS);
  // Se i font non si caricano si parte comunque, con quelli di sistema: meglio che uno schermo vuoto.
  const fontsReady = fontsLoaded || !!fontError;
  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady]);
  if (!fontsReady) return null;
  if (MISCONFIGURED) return <Misconfigured />;

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <SessionProvider>
          <ToastProvider>
            <StatusBar style="light" />
            {/* Su web e tablet l'app resta larga come un telefono, centrata sull'inchiostro. */}
            <View style={styles.outer}>
              <View style={styles.frame}>
                <Gate />
                <Offline />
                <Banned />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="benvenuto" options={{ animation: 'fade', gestureEnabled: false }} />
                  <Stack.Screen name="scatta" options={{ presentation: 'fullScreenModal' }} />
                  <Stack.Screen
                    name="commenti/[postId]"
                    options={{
                      presentation: 'formSheet',
                      // Su Android il foglio a metà nasconde la casella in basso: lì si apre subito alto.
                      sheetAllowedDetents: Platform.OS === 'android' ? [0.95] : [0.6, 0.95],
                      sheetGrabberVisible: true,
                      sheetCornerRadius: 24,
                      contentStyle: { backgroundColor: color.sheet },
                    }}
                  />
                  <Stack.Screen
                    name="regole"
                    options={{ presentation: 'formSheet', sheetAllowedDetents: [0.92], sheetGrabberVisible: true, sheetCornerRadius: 24, contentStyle: { backgroundColor: color.sheet } }}
                  />
                  <Stack.Screen
                    name="azioni/[postId]"
                    options={{ presentation: 'formSheet', sheetAllowedDetents: [0.55, 0.9], sheetGrabberVisible: true, sheetCornerRadius: 24, contentStyle: { backgroundColor: color.sheet } }}
                  />
                  <Stack.Screen name="impostazioni" />
                  <Stack.Screen name="moderazione" />
                  <Stack.Screen name="amministrazione" />
                  <Stack.Screen name="verifica" />
                  <Stack.Screen name="notifiche" />
                  <Stack.Screen name="seguaci/[username]" />
                  <Stack.Screen name="legale/[doc]" />
                  <Stack.Screen name="utente/[username]" />
                  <Stack.Screen name="post/[id]" />
                  <Stack.Screen name="copertina/[day]" />
                </Stack>
              </View>
            </View>
          </ToastProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Una build di produzione senza Supabase girerebbe in demo con contenuti finti: gli store la
 * rifiuterebbero e gli utenti non vedrebbero gli altri. Meglio fermarsi e dirlo.
 */
const MISCONFIGURED = process.env.EXPO_PUBLIC_APP_ENV === 'production' && isDemo;

function Misconfigured() {
  return (
    <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }]}>
      <Txt variant="title" style={{ textAlign: 'center' }}>
        Configurazione mancante
      </Txt>
      <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
        Questa build di produzione non ha l’indirizzo e la chiave di Supabase. Impostali come variabili d’ambiente EAS e rifai la build.
      </Txt>
    </View>
  );
}

/**
 * Chi non ha ancora un profilo passa dal benvenuto. Termini e privacy restano leggibili anche prima:
 * si devono poter leggere prima di accettarli.
 */
function Gate() {
  const { me } = useSession();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  // Un link aperto da fuori (un post condiviso) prima di accedere: dopo l'accesso si va lì, non in copertina.
  const intended = useRef<string | null>(null);
  useEffect(() => {
    if (me === undefined) return;
    const onWelcome = segments[0] === 'benvenuto';
    const open = onWelcome || segments[0] === 'legale';
    if (!me && !open) {
      if (me === null && /^\/(post|utente)\//.test(pathname)) intended.current = pathname;
      // Uscendo (account eliminato, demo azzerata) non deve restare nulla sotto il benvenuto.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/benvenuto' as Href);
    }
    if (me && onWelcome) {
      const to = intended.current ?? '/';
      intended.current = null;
      router.replace(to as Href);
    }
  }, [me, router, segments, pathname]);
  return null;
}

/** Account chiuso: lo si dice chiaramente, con il contatto per il ricorso, invece di mostrare errori sparsi. */
function Banned() {
  const { status, setMe } = useSession();
  if (!status?.banned) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.fill, { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, zIndex: 11 }]}>
      <Txt variant="title" style={{ textAlign: 'center' }}>
        Il tuo account è stato chiuso.
      </Txt>
      <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
        È stato chiuso per una violazione delle linee guida o perché non rispetta l’età minima. Se pensi sia un errore scrivi a {OWNER.email}.
      </Txt>
      <Press
        style={styles.retry}
        onPress={() => {
          void flushViews()
            .then(logout)
            .catch(() => undefined)
            .then(() => setMe(null));
        }}
        accessibilityRole="button">
        <Txt variant="label" tone={color.canvas}>
          Esci
        </Txt>
      </Press>
    </View>
  );
}

/** Senza rete all'avvio non si sa se hai un account: lo si dice e si offre di riprovare. */
function Offline() {
  const { me, error, retry } = useSession();
  if (me !== undefined || !error) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.fill, { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, zIndex: 10 }]}>
      <Txt variant="title" style={{ textAlign: 'center' }}>
        Non riesco a collegarmi.
      </Txt>
      <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
        Controlla la connessione e riprova.
      </Txt>
      <Press style={styles.retry} onPress={retry} accessibilityRole="button">
        <Txt variant="label" tone={color.canvas}>
          Riprova
        </Txt>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.canvas },
  retry: { marginTop: 12, backgroundColor: color.giallo, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  outer: { flex: 1, backgroundColor: Platform.OS === 'web' ? '#070B14' : color.canvas, alignItems: 'center' },
  frame: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 460 : undefined, backgroundColor: color.canvas, overflow: 'hidden' },
});
