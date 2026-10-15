import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { isDemo } from '../src/services/api';
import { FONTS } from '../src/design/fonts';
import { color } from '../src/design/tokens';
import { SessionProvider, useSession } from '../src/state/session';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsReady] = useFonts(FONTS);
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
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="benvenuto" options={{ animation: 'fade' }} />
                  <Stack.Screen name="scatta" options={{ presentation: 'fullScreenModal' }} />
                  <Stack.Screen
                    name="commenti/[postId]"
                    options={{
                      presentation: 'formSheet',
                      sheetAllowedDetents: [0.6, 0.95],
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

/** Chi non ha ancora un profilo passa dal benvenuto. */
function Gate() {
  const { me } = useSession();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (me === undefined) return;
    const onWelcome = segments[0] === 'benvenuto';
    if (!me && !onWelcome) router.replace('/benvenuto' as Href);
    if (me && onWelcome) router.replace('/' as Href);
  }, [me, router, segments]);
  return null;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.canvas },
  outer: { flex: 1, backgroundColor: Platform.OS === 'web' ? '#070B14' : color.canvas, alignItems: 'center' },
  frame: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 460 : undefined, backgroundColor: color.canvas, overflow: 'hidden' },
});
