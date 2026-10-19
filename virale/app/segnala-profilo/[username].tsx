import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '../../src/components/Press';
import { ReportReasons } from '../../src/components/ReportReasons';
import { SheetClose } from '../../src/components/SheetClose';
import { useToast } from '../../src/components/Toast';
import { Txt } from '../../src/components/Txt';
import { color, space } from '../../src/design/tokens';
import { getProfile, reportProfile, type ReportReason } from '../../src/services/api';
import { friendlyError } from '../../src/services/errors';
import { useGoBack } from '../../src/state/useGoBack';

/** Segnala un profilo (nome, bio o foto), in un foglio come le azioni sui post. */
export default function ReportProfileSheet() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const insets = useSafeAreaInsets();
  const goBack = useGoBack(`/utente/${username}`);
  const toast = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getProfile(username)
      .then((d) => alive && setUserId(d.profile.isMe ? null : d.profile.id))
      .catch((e: unknown) => alive && setError(friendlyError(e)));
    return () => {
      alive = false;
    };
  }, [username]);

  const report = async (reason: ReportReason) => {
    if (!userId || busy) return;
    try {
      setBusy(true);
      setError(null);
      await reportProfile(userId, reason);
      haptic('success');
      goBack();
      toast('Grazie: profilo segnalato. Lo controlliamo entro 24 ore.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: space[5], paddingTop: space[6], paddingBottom: insets.bottom + space[6], gap: space[3] }}>
      <SheetClose />
      {userId ? (
        <ReportReasons title={`Segnala @${username}`} who={`@${username}`} disabled={busy} onPick={(r) => void report(r)} />
      ) : !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.giallo} />
        </View>
      ) : null}
      {error ? (
        <Txt variant="small" tone={color.matita}>
          {error}
        </Txt>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.sheet },
  center: { paddingVertical: space[8], alignItems: 'center' },
});
