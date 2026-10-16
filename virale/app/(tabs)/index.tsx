import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';

import { haptic, Press } from '../../src/components/Press';
import { useToast } from '../../src/components/Toast';
import { Txt } from '../../src/components/Txt';
import { atTime } from '../../src/design/format';
import { color } from '../../src/design/tokens';
import { coverDay, msUntilReveal } from '../../src/engine/engine';
import { CoverView } from '../../src/screens/CoverView';
import { closeDayNowDemo, getTodayCover, isDemo } from '../../src/services/api';
import { getJson, setJson } from '../../src/services/storage';
import { useSession } from '../../src/state/session';
import type { Cover } from '../../src/types';

const SEEN_KEY = 'virale.cover.seen';



export default function CoverTab() {
  const { me, version, bump } = useSession();
  const toast = useToast();
  const [cover, setCover] = useState<Cover | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [reveal, setReveal] = useState(false);
  const loadedDay = useRef('');
  const { status } = useSession();
  const revealRef = useRef(0);
  revealRef.current = status?.settings.revealMinutes ?? 0;
  /** Ricarica solo la copertina (non tutta l'app, che farebbe ripartire anche il feed). */
  const [tick, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      void version; // ricarica quando altrove cambia qualcosa (nuovo post, nuova copertina)
      void tick;
      // Prima di avere un profilo (benvenuto) non si carica nulla: la "rivelazione" del giorno resta per dopo.
      if (!me) return;
      let alive = true;
      void (async () => {
        // Il "giorno" della copertina dipende dall'orario di rivelazione scelto dall'amministratore.
        const today = coverDay(revealRef.current);
        let next: Cover | null;
        try {
          next = await getTodayCover();
        } catch {
          if (alive) setFailed(true);
          return;
        }
        const seen = await getJson<string>(SEEN_KEY, '');
        if (!alive) return;
        loadedDay.current = today;
        setFailed(false);
        // "Già vista" si riferisce a quella copertina precisa, non al giorno in cui la si apre.
        const fresh = Boolean(next) && seen !== next?.featuredOn;
        setReveal(fresh);
        setCover(next);
        if (next && fresh) void setJson(SEEN_KEY, next.featuredOn);
      })();
      return () => {
        alive = false;
      };
    }, [me, version, tick]),
  );

  // All'orario della copertina la nuova arriva entro un minuto (la sceglie il server): finché non c'è si riprova ogni 30 s.
  // Anche se si vede ancora la copertina precedente (quella nuova non è ancora stata scelta), nei primi
  // minuti dopo l'orario si ricontrolla ogni 20 secondi.
  useEffect(() => {
    if (cover === undefined) return;
    const justClosed = 86_400_000 - msUntilReveal(revealRef.current) < 5 * 60_000;
    const stale = cover === null || (justClosed && cover.featuredOn < coverDay(revealRef.current));
    if (!stale) return;
    const id = setInterval(() => setTick((n) => n + 1), cover === null ? 30_000 : 20_000);
    return () => clearInterval(id);
  }, [cover, tick]);

  // Riaprendo l'app il giorno dopo (dal multitasking) la copertina si aggiorna da sola.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && loadedDay.current && loadedDay.current !== coverDay(revealRef.current)) setTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const simulate = async () => {
    const next = await closeDayNowDemo();
    haptic('success');
    setReveal(true);
    setCover(next);
    bump();
    toast(next ? `Nuova copertina: @${next.post.author.username}` : 'Nessun post idoneo oggi.');
    // La nuova copertina può essere di un post che hai segnalato o di qualcuno che hai bloccato: si ricarica
    // con le stesse regole di sempre invece di mostrarla comunque.
    setTick((n) => n + 1);
  };

  if (failed && !cover) {
    return (
      <View style={styles.center}>
        <Txt variant="title" style={{ textAlign: 'center' }}>
          Non riesco a caricare la copertina.
        </Txt>
        <Press style={styles.retry} onPress={() => setTick((n) => n + 1)} accessibilityRole="button">
          <Txt variant="label" tone={color.canvas}>
            Riprova
          </Txt>
        </Press>
      </View>
    );
  }
  if (cover === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.giallo} />
      </View>
    );
  }
  if (!cover) {
    return (
      <View style={styles.center}>
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          Nessuna copertina da mostrarti oggi.
        </Txt>
        <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
          La prossima esce {atTime(revealRef.current)}: intanto guarda i Provini, o pubblica un post e candidalo.
        </Txt>
        {isDemo ? (
          <Press onPress={() => void simulate()} accessibilityRole="button" style={{ marginTop: 12 }}>
            <Txt variant="meta" tone={color.paperFaint} style={{ textDecorationLine: 'underline' }}>
              Demo: simula la fine della gara
            </Txt>
          </Press>
        ) : null}
      </View>
    );
  }
  return <CoverView key={`${cover.featuredOn}-${cover.post.id}`} cover={cover} isToday reveal={reveal} onSimulateMidnight={isDemo ? () => void simulate() : undefined} onDayEnd={() => setTick((n) => n + 1)} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: color.canvas },
  retry: { marginTop: 12, backgroundColor: color.giallo, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
});
