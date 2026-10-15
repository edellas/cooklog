import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../src/components/Icon';
import { SheetClose } from '../src/components/SheetClose';
import { TierLadder } from '../src/components/TierLadder';
import { Txt } from '../src/components/Txt';
import { color, radius, space } from '../src/design/tokens';
import { TIER_NAMES, TIERS } from '../src/services/api';

const RULES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'scatta', title: 'Un post in gara al giorno', text: 'Pubblica quanto vuoi, ma candidane uno solo al giorno. Le candidature chiudono alle 20:00.' },
  { icon: 'provini', title: 'Visti alla cieca', text: 'Nei Provini è l’app a scegliere cosa mostrare a ciascuno. Non puoi cercare un amico per votarlo e non vedi mai il tuo post.' },
  { icon: 'cerchia', title: 'Il voto è come guardi', text: 'Contano guardare fino in fondo, riguardare, commentare, salvare, condividere e cerchiare. Scorrere via subito conta contro. Le segnalazioni pesano molto.' },
  { icon: 'copertina', title: 'Una sola copertina', text: 'A mezzanotte vince chi è salito più in alto; a parità, chi ha il punteggio più solido su più viste. Il giorno dopo è la prima cosa che vede chiunque apra l’app.' },
  { icon: 'segnala', title: 'Niente trucchi', text: 'Un voto a testa per post. Gli account creati da meno di 24 ore guardano ma non votano. Oltre il 2% di segnalazioni si è fuori gara. Chi va in copertina aspetta 30 giorni prima di ricandidarsi.' },
];

export default function RulesSheet() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: space[5], paddingTop: space[6], paddingBottom: insets.bottom + space[8], gap: space[6] }}>
      <SheetClose />
      <View style={{ gap: space[2] }}>
        <Txt variant="heading">Come si diventa copertina</Txt>
        <Txt variant="body" tone={color.paperDim}>
          Ogni post candidato parte da un piccolo pubblico. Se piace più dell’80% degli altri post allo stesso gradino, sale e lo vedono più persone.
        </Txt>
      </View>

      <View style={styles.ladder}>
        <TierLadder entry={{ tier: 2, status: 'active', views: 1210 }} />
        <View style={styles.steps}>
          {TIER_NAMES.map((name, i) => (
            <View key={name} style={styles.step}>
              <Txt variant="label">{name}</Txt>
              <Txt variant="meta" tone={color.paperFaint}>
                {i < TIERS.length ? `fino a ${TIERS[i].toLocaleString('it-IT')} viste` : 'pubblico aperto fino a mezzanotte'}
              </Txt>
            </View>
          ))}
        </View>
      </View>

      {RULES.map((r) => (
        <View key={r.title} style={styles.rule}>
          <View style={styles.ruleIcon}>
            <Icon name={r.icon} size={22} color={color.giallo} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="label">{r.title}</Txt>
            <Txt variant="small" tone={color.paperDim}>
              {r.text}
            </Txt>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.sheet },
  ladder: { backgroundColor: color.raised, borderRadius: radius.card, padding: space[4], gap: space[4] },
  steps: { gap: space[2] },
  step: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  rule: { flexDirection: 'row', gap: space[4] },
  ruleIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
});
