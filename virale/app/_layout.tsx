import { useFonts } from 'expo-font';
import { Stack, useGlobalSearchParams, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '../src/components/Toast';
import { Press } from '../src/components/Press';
import { Txt } from '../src/components/Txt';
import { isDemo, logout } from '../src/services/api';
import { ownerEmail, ownerMissing } from '../src/legal/docs';
import { refreshPushToken, usePushNavigation } from '../src/services/push';
import { noteInAppNavigation } from '../src/state/nav';
import { flushViews } from '../src/state/views';
import { FONTS } from '../src/design/fonts';
import { color } from '../src/design/tokens';
import { SessionProvider, useSession } from '../src/state/session';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Aperta da un link (una copertina, un post), l'app ha comunque i tab sotto: "indietro" porta lì.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONTS);
  // Sui tablet (Android 16 non blocca più l'orientamento) l'app resta larga come un telefono, centrata.
  const { width } = useWindowDimensions();
  const frameMax = Platform.OS === 'web' ? 460 : width >= 700 ? 520 : undefined;
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
              <View style={[styles.frame, { maxWidth: frameMax }]}>
                <Gate />
                <PushBridge />
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
                  <Stack.Screen
                    name="segnala-profilo/[username]"
                    options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 0.95], sheetGrabberVisible: true, sheetCornerRadius: 24, contentStyle: { backgroundColor: color.sheet } }}
                  />
                  <Stack.Screen name="impostazioni" />
                  <Stack.Screen name="modifica-profilo" />
                  <Stack.Screen name="cerca" />
                  <Stack.Screen name="moderazione" />
                  <Stack.Screen name="amministrazione" />
                  <Stack.Screen name="verifica" />
                  <Stack.Screen name="notifiche" />
                  <Stack.Screen name="seguaci/[username]" />
                  <Stack.Screen name="legale/[doc]" />
                  <Stack.Screen name="utente/[username]" />
                  <Stack.Screen name="post/[id]" />
                  <Stack.Screen name="scorri/[username]" />
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
 * Una build di produzione senza Supabase girerebbe in demo con contenuti finti, e senza i dati del titolare
 * mostrerebbe documenti legali con i segnaposto: gli store la rifiuterebbero. Meglio fermarsi e dirlo,
 * con i nomi delle variabili mancanti (mai i valori). Le build "preview" restano utilizzabili per le prove.
 */
const MISSING_CONFIG: string[] =
  process.env.EXPO_PUBLIC_APP_ENV === 'production'
    ? [...(isDemo ? ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'] : []), ...ownerMissing()]
    : [];
const MISCONFIGURED = MISSING_CONFIG.length > 0;

function Misconfigured() {
  return (
    <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }]}>
      <Txt variant="title" style={{ textAlign: 'center' }}>
        Configurazione mancante
      </Txt>
      <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
        Questa build di produzione non ha alcuni dati obbligatori. Impostali come variabili d’ambiente EAS e rifai la build:
      </Txt>
      {MISSING_CONFIG.map((name) => (
        <Txt key={name} variant="label" style={{ textAlign: 'center' }}>
          {name}
        </Txt>
      ))}
    </View>
  );
}

/** Rotte che si possono aprire da un link (o ricaricando la pagina sul web): ritrovate dopo l'accesso. */
const OPENABLE = new Set(['post', 'utente', 'scorri', 'copertina', 'commenti', 'seguaci', 'regole', 'notifiche', 'verifica', 'cerca']);

/**
 * Chi non ha ancora un profilo passa dal benvenuto. Termini e privacy restano leggibili anche prima:
 * si devono poter leggere prima di accettarli.
 */
function Gate() {
  const { me } = useSession();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const router = useRouter();
  // Un link aperto da fuori (un post condiviso, una copertina) prima di accedere: dopo l'accesso si va lì,
  // con i suoi parametri, non in copertina.
  const intended = useRef<Href | null>(null);
  useEffect(() => {
    if (me === undefined) return;
    const onWelcome = segments[0] === 'benvenuto';
    const open = onWelcome || segments[0] === 'legale';
    if (!me && !open) {
      if (me === null && OPENABLE.has(segments[0] ?? '')) {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(params)) if (typeof v === 'string') clean[k] = v;
        intended.current = { pathname: `/${segments.join('/')}`, params: clean } as Href;
      }
      // Uscendo (account eliminato, demo azzerata) non deve restare nulla sotto il benvenuto.
      if (router.canDismiss()) router.dismissAll();
      noteInAppNavigation();
      router.replace('/benvenuto' as Href);
    }
    if (me && onWelcome) {
      const to = intended.current ?? ('/' as Href);
      intended.current = null;
      noteInAppNavigation();
      router.replace(to);
    }
  }, [me, router, segments, params]);
  return null;
}

/**
 * Notifiche push: a ogni accesso (e all'avvio) il token del telefono si aggiorna in silenzio, se il permesso
 * c'è già; il tocco su una notifica apre la schermata giusta.
 */
function PushBridge() {
  const { me } = useSession();
  usePushNavigation(me !== undefined);
  const id = me?.id;
  useEffect(() => {
    if (id) void refreshPushToken();
  }, [id]);
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
        {`È stato chiuso per una violazione delle linee guida o perché non rispetta l’età minima.${ownerEmail() ? ` Se pensi sia un errore scrivi a ${ownerEmail()}.` : ''}`}
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
  frame: { flex: 1, width: '100%', backgroundColor: color.canvas, overflow: 'hidden' },
});
