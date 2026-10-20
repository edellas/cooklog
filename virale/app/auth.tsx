import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Press } from '../src/components/Press';
import { Txt } from '../src/components/Txt';
import { color, space } from '../src/design/tokens';
import { isDemo } from '../src/services/api';
import { friendlyError } from '../src/services/errors';
import { finishCallback } from '../src/services/oauth';
import { useSession } from '../src/state/session';

type Params = { code?: string; error?: string; error_code?: string; error_description?: string };

/**
 * Ritorno dall'accesso con Google o Facebook come link all'app (`virale://auth?code=…`): succede su Android
 * quando il browser riapre l'app invece di restituire il risultato, o se il sistema aveva chiuso l'app nel
 * frattempo. Si scambia il codice (una volta sola, anche se lo sta già facendo il benvenuto) e si rilegge
 * l'account: il Gate in app/_layout.tsx porta poi a "Completa il profilo" o dentro l'app.
 */
export default function AuthCallback() {
  const params = useLocalSearchParams<Params>();
  const router = useRouter();
  const { refreshAuth } = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const back = () => router.replace('/benvenuto' as Href);
    if (isDemo) return back();
    void (async () => {
      try {
        const res = await finishCallback(params);
        if (res === 'cancel') return back();
        const st = await refreshAuth();
        if (!st.me && !st.pending) back();
      } catch (e) {
        setError(friendlyError(e));
      }
    })();
  }, [params, refreshAuth, router]);

  return (
    <View style={styles.root}>
      {error ? (
        <>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            Accesso non riuscito
          </Txt>
          <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
            {error}
          </Txt>
          <Press style={styles.retry} onPress={() => router.replace('/benvenuto' as Href)} accessibilityRole="button">
            <Txt variant="label" tone={color.canvas}>
              Torna all’inizio
            </Txt>
          </Press>
        </>
      ) : (
        <>
          <ActivityIndicator color={color.giallo} />
          <Txt variant="body" tone={color.paperDim}>
            Accesso in corso…
          </Txt>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[3] },
  retry: { marginTop: space[3], backgroundColor: color.giallo, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
});
