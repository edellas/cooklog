import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TIER_THRESHOLDS } from '../services/api';
import { colors, formatCount } from '../theme';

const RULES: [string, string][] = [
  ['Un contenuto al giorno', 'Puoi candidare un solo video, foto o testo al giorno. Le candidature chiudono alle 20:00.'],
  ['Visti alla cieca', 'Nell’Arena è il server a scegliere cosa mostrare a ciascuno. Non puoi cercare un amico per votarlo e non vedi mai il tuo contenuto.'],
  ['Il tuo voto è come guardi', 'Contano: guardarlo fino in fondo, riguardarlo, condividerlo e metterci like. Scorrere subito via è un voto contro. Le segnalazioni pesano molto.'],
  [
    'Livelli come su TikTok',
    `Ogni contenuto parte da un piccolo pubblico. Se piace più dell’80% degli altri allo stesso livello, sale: ${TIER_THRESHOLDS.map(formatCount).join(' → ')} viste, poi la finale.`,
  ],
  ['Un solo vincitore', 'A mezzanotte vince chi è arrivato più in alto. A parità vince chi ha il punteggio più solido su più viste: la fortuna su pochi spettatori non basta.'],
  ['Visto da tutti', 'Il giorno dopo il vincitore è la prima cosa che vede chiunque apra l’app, e entra nell’Albo d’oro.'],
  ['Regole anti-trucchi', 'Si vota una volta per contenuto. Gli account creati da meno di 24 ore guardano ma non votano. Oltre il 2% di segnalazioni si è squalificati. Chi vince non può ripartecipare per 30 giorni.'],
];

export function RulesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>Come funziona</Text>
        {RULES.map(([title, text], i) => (
          <Text key={title} style={styles.item}>
            <Text style={styles.itemTitle}>
              {i + 1}. {title}
              {'\n'}
            </Text>
            {text}
          </Text>
        ))}
        <Pressable style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Ho capito</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 20, gap: 14 },
  title: { color: '#FFF', fontSize: 26, fontWeight: '900' },
  item: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  itemTitle: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  button: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#FFF', fontWeight: '900' },
});
