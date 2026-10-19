import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Field } from "../../src/components/Field";
import { Icon } from "../../src/components/Icon";
import { Avatar } from "../../src/components/Avatar";
import { haptic, Press } from "../../src/components/Press";
import { ReportReasons } from "../../src/components/ReportReasons";
import { useToast } from "../../src/components/Toast";
import { Txt } from "../../src/components/Txt";
import { timeAgo } from "../../src/design/format";
import { charCount, clampChars } from "../../src/design/text";
import { color, font, radius, space } from "../../src/design/tokens";
import {
  addComment,
  blockUser,
  deleteComment,
  getComments,
  getPost,
  reportComment,
  type ReportReason,
} from "../../src/services/api";
import { friendlyError } from "../../src/services/errors";
import { useNav } from "../../src/state/nav";
import { emitPostChange, emitPostGone } from "../../src/state/postEvents";
import { useSession } from "../../src/state/session";
import { useGoBack } from "../../src/state/useGoBack";
import type { Comment } from "../../src/types";

const MAX = 300;
/** get_comments restituisce al massimo 300 commenti: sotto, l'elenco è completo e il suo numero è quello vero. */
const LIST_LIMIT = 300;

/** Pannello delle azioni su un commento, dentro lo stesso foglio (niente secondo foglio sopra il primo). */
type Panel = { comment: Comment; step: "menu" | "segnala" | "blocca" | "elimina" } | null;

/** Commenti in un foglio nativo (formSheet): si apre a metà, si trascina fino in cima, si chiude con un gesto. */
export default function CommentsSheet() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const goBack = useGoBack();
  const toast = useToast();
  const { me, status, version, bump } = useSession();
  const blocked = status?.identity?.canAct === false;
  const [items, setItems] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  /** Il post non esiste più (eliminato, rimosso, di qualcuno bloccato): niente casella per scrivere. */
  const [gone, setGone] = useState(false);
  /** Commento proprio in attesa di conferma per l'eliminazione (secondo tocco). */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelBusy, setPanelBusy] = useState(false);
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList<Comment>>(null);

  /** Rispondi: la casella parte con @nome, pronta per scrivere. */
  const reply = (username: string) => {
    const tag = `@${username} `;
    setText((t) => clampChars(t.startsWith(tag) ? t : tag + t.replace(/^@\S+\s/, ""), MAX));
    input.current?.focus();
  };

  /** Il numero sotto il post: quello dell'elenco se è completo, altrimenti quello del server. */
  const publishCount = useCallback(
    (list: Comment[], commented = false) => {
      if (list.length < LIST_LIMIT) emitPostChange(postId, { commentCount: list.length, commented });
      else
        getPost(postId)
          .then((p) => emitPostChange(postId, { commentCount: p.commentCount, commented }))
          .catch(() => undefined);
    },
    [postId],
  );

  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => {
    let alive = true;
    // Il post insieme ai commenti: se non esiste più lo si dice subito, invece di invitare a scrivere.
    Promise.all([
      getComments(postId),
      getPost(postId).then(
        () => false,
        (e: unknown) => /non trovato|non più disponibile/i.test(friendlyError(e)),
      ),
    ])
      .then(([list, missing]) => {
        if (!alive) return;
        setGone(missing);
        setItems(missing ? [] : list);
        setLoadError(false);
        if (!missing) publishCount(list);
      })
      .catch(() => alive && setLoadError(true))
      .finally(() => alive && setRefreshing(false));
    return () => {
      alive = false;
    };
  }, [postId, publishCount]);

  // Si ricarica tornando in primo piano (dal profilo di un autore appena bloccato) e quando altrove cambia
  // qualcosa (version): all'apertura il focus arriva una volta sola, quindi un solo caricamento.
  useFocusEffect(
    useCallback(() => {
      void version;
      return load();
    }, [load, version]),
  );

  const send = async () => {
    if (sending || !text.trim() || gone) return;
    try {
      setSending(true);
      setError(null);
      const c = await addComment(postId, text);
      haptic("light");
      setText("");
      if (items === null) {
        // L'elenco non era arrivato: si ricarica tutto invece di mostrare solo il nuovo commento.
        load();
      } else {
        const next = [...items, c];
        setItems(next);
        publishCount(next, true);
        // Il commento appena scritto si vede subito, in fondo.
        setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSending(false);
    }
  };

  const remove = async (c: Comment, confirmed = false) => {
    if (!confirmed && confirmId !== c.id) {
      setConfirmId(c.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmId(null), 4000);
      return;
    }
    try {
      setConfirmId(null);
      await deleteComment(postId, c.id);
      const next = (items ?? []).filter((x) => x.id !== c.id);
      setItems(next);
      publishCount(next);
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  /** Azioni del pannello: segnala (il commento sparisce per me), blocca (spariscono tutti i suoi), elimina. */
  const panelRun = async (fn: () => Promise<void>, after: (list: Comment[]) => Comment[], done: string) => {
    if (panelBusy) return;
    try {
      setPanelBusy(true);
      await fn();
      haptic("success");
      const next = after(items ?? []);
      setItems(next);
      publishCount(next);
      setPanel(null);
      toast(done);
    } catch (e) {
      toast(friendlyError(e), "error");
    } finally {
      setPanelBusy(false);
    }
  };
  const report = (c: Comment, reason: ReportReason) =>
    void panelRun(() => reportComment(c.id, reason), (l) => l.filter((x) => x.id !== c.id), "Grazie: commento segnalato. Non lo vedrai più.");
  const block = (c: Comment) =>
    void panelRun(
      async () => {
        await blockUser(c.author.id);
        emitPostGone({ authorId: c.author.id });
        bump();
      },
      (l) => l.filter((x) => x.author.id !== c.author.id),
      `@${c.author.username} è bloccato.`,
    );
  const removeFromPanel = (c: Comment) =>
    void panelRun(() => deleteComment(postId, c.id), (l) => l.filter((x) => x.id !== c.id), "Commento eliminato.");

  return (
    // Su Android il foglio si sposta già da solo sopra la tastiera: lì niente padding in più.
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.head}>
        <Txt variant="title">
          {items && !gone
            ? `${items.length} ${items.length === 1 ? "commento" : "commenti"}`
            : "Commenti"}
        </Txt>
        {Platform.OS === "web" ? (
          <Press
            style={styles.close}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Chiudi"
          >
            <Icon name="chiudi" size={20} />
          </Press>
        ) : null}
      </View>
      {gone ? (
        <Txt variant="body" tone={color.paperFaint} style={styles.message}>
          Questo post non è più disponibile.
        </Txt>
      ) : loadError && items === null ? (
        <Txt variant="body" tone={color.paperFaint} style={styles.message}>
          Non riesco a caricare i commenti. Controlla la connessione e riaprili.
        </Txt>
      ) : items === null ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          ref={list}
          data={items}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(c) => c.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={color.giallo}
              colors={[color.giallo]}
              progressBackgroundColor={color.raised}
            />
          }
          contentContainerStyle={{
            paddingHorizontal: space[5],
            paddingBottom: space[4],
            gap: space[4],
          }}
          ListEmptyComponent={
            <Txt
              variant="body"
              tone={color.paperFaint}
              style={{ textAlign: "center", marginTop: space[8] }}
            >
              Ancora nessun commento. Scrivi il primo.
            </Txt>
          }
          renderItem={({ item }) => {
            const mine = item.author.id === me?.id;
            return (
              <Press
                style={styles.row}
                scaleTo={1}
                // Pressione lunga: le azioni sul commento (come i tre puntini).
                onLongPress={() => setPanel({ comment: item, step: "menu" })}
                delayLongPress={450}
                accessibilityRole="text"
                accessibilityLabel={`@${item.author.username}: ${item.body}`}
                accessibilityActions={[{ name: "longpress", label: "Azioni sul commento" }]}
                onAccessibilityAction={() => setPanel({ comment: item, step: "menu" })}
              >
                {/* Toccando l'autore si apre il suo profilo. */}
                <Press
                  onPress={() => nav.push(`/utente/${item.author.username}`)}
                  accessibilityRole="link"
                  accessibilityLabel={`Profilo di @${item.author.username}`}
                  hitSlop={6}
                >
                  <Avatar
                    name={item.author.displayName}
                    seed={item.author.username}
                    uri={item.author.avatar}
                    size={32}
                  />
                </Press>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="meta" tone={color.paperFaint}>
                    <Txt
                      variant="meta"
                      style={{ fontFamily: font.uiBold }}
                      onPress={() => nav.push(`/utente/${item.author.username}`)}
                    >
                      @{item.author.username}
                    </Txt>
                    {"  "}
                    {timeAgo(item.createdAt)}
                  </Txt>
                  <Txt variant="body">{item.body}</Txt>
                  <View style={styles.rowActions}>
                    {!mine && !blocked ? (
                      <Press
                        onPress={() => reply(item.author.username)}
                        accessibilityRole="button"
                        accessibilityLabel={`Rispondi a @${item.author.username}`}
                        style={styles.small}
                        hitSlop={4}
                      >
                        <Txt variant="meta" tone={color.paperFaint}>
                          Rispondi
                        </Txt>
                      </Press>
                    ) : null}
                    {mine ? (
                      <Press
                        onPress={() => void remove(item)}
                        accessibilityRole="button"
                        style={styles.small}
                        hitSlop={4}
                      >
                        <Txt
                          variant="meta"
                          tone={
                            confirmId === item.id
                              ? color.matita
                              : color.paperFaint
                          }
                        >
                          {confirmId === item.id
                            ? "Tocca di nuovo per eliminare"
                            : "Elimina"}
                        </Txt>
                      </Press>
                    ) : null}
                  </View>
                </View>
                <Press
                  style={styles.more}
                  onPress={() => setPanel({ comment: item, step: "menu" })}
                  accessibilityRole="button"
                  accessibilityLabel={mine ? "Opzioni del tuo commento" : `Segnala o blocca @${item.author.username}`}
                  hitSlop={4}
                >
                  <Icon name="altro" size={20} color={color.paperFaint} />
                </Press>
              </Press>
            );
          }}
        />
      )}
      {error ? (
        <Txt
          variant="small"
          tone={color.matita}
          style={{ paddingHorizontal: space[5] }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Txt>
      ) : null}
      {gone ? (
        // Il post non c'è più: la casella resta, spenta, per non lasciare un vuoto in fondo al foglio.
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
          <Field containerStyle={{ flex: 1, opacity: 0.5 }} style={styles.input} value="" editable={false} placeholder="Non si possono più aggiungere commenti" accessibilityLabel="Scrivi un commento" accessibilityState={{ disabled: true }} />
        </View>
      ) : blocked ? (
        <Press
          style={[
            styles.composer,
            { paddingBottom: Math.max(insets.bottom, space[3]) },
          ]}
          onPress={() => nav.push("/verifica")}
          accessibilityRole="button"
        >
          <Txt
            variant="small"
            tone={color.paperDim}
            style={{ flex: 1, paddingVertical: space[2] }}
          >
            {status?.identity?.status === 'pending'
              ? 'Per commentare serve la verifica dell’età: il tuo documento è in controllo.'
              : 'Per commentare serve la verifica dell’età: tocca qui per caricare il documento.'}
          </Txt>
        </Press>
      ) : (
        <View
          style={[
            styles.composer,
            { paddingBottom: Math.max(insets.bottom, space[3]) },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Field
              ref={input}
              style={styles.input}
              value={text}
              // Limite in caratteri come il server (un'emoji è uno): niente maxLength, che conta il doppio.
              onChangeText={(t) => setText(clampChars(t, MAX))}
              placeholder="Aggiungi un commento"
              accessibilityLabel="Scrivi un commento"
              multiline
              // Sul web Invio invia e Maiusc+Invio va a capo, come nelle chat.
              onKeyPress={
                Platform.OS === "web"
                  ? (e) => {
                      const ev = e as unknown as { key?: string; shiftKey?: boolean; nativeEvent: { isComposing?: boolean }; preventDefault: () => void };
                      if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                        ev.preventDefault();
                        void send();
                      }
                    }
                  : undefined
              }
            />
            {charCount(text) >= MAX - 50 ? (
              <Txt variant="meta" tone={charCount(text) >= MAX ? color.matita : color.paperFaint} style={{ alignSelf: "flex-end" }}>
                {charCount(text)}/{MAX}
              </Txt>
            ) : null}
          </View>
          <Press
            style={[styles.send, !text.trim() && styles.sendOff]}
            onPress={() => void send()}
            disabled={!text.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Invia commento"
          >
            {sending ? (
              <ActivityIndicator color={color.canvas} />
            ) : (
              <Icon
                name="invia"
                size={20}
                color={color.canvas}
                strokeWidth={2.4}
              />
            )}
          </Press>
        </View>
      )}

      {panel ? (
        <View style={StyleSheet.absoluteFill}>
          <Press style={styles.backdrop} scaleTo={1} onPress={() => setPanel(null)} accessibilityRole="button" accessibilityLabel="Chiudi le azioni sul commento">
            <View />
          </Press>
          <ScrollView
            style={[styles.panel, { paddingBottom: insets.bottom }]}
            contentContainerStyle={{ padding: space[5], gap: space[3], paddingBottom: space[6] }}
            keyboardShouldPersistTaps="handled"
          >
            {panel.step === "menu" ? (
              <>
                <Txt variant="small" tone={color.paperDim} numberOfLines={2}>
                  @{panel.comment.author.username}: “{panel.comment.body}”
                </Txt>
                {panel.comment.author.id === me?.id ? (
                  <PanelRow icon="cestino" label="Elimina" danger onPress={() => setPanel({ ...panel, step: "elimina" })} />
                ) : (
                  <>
                    <PanelRow icon="segnala" label="Segnala commento" hint="Per te sparisce subito. Lo controlliamo entro 24 ore." danger onPress={() => setPanel({ ...panel, step: "segnala" })} />
                    <PanelRow icon="blocca" label={`Blocca @${panel.comment.author.username}`} hint="Non vedrete più i contenuti l’uno dell’altro." onPress={() => setPanel({ ...panel, step: "blocca" })} />
                  </>
                )}
                <PanelRow label="Annulla" onPress={() => setPanel(null)} />
              </>
            ) : panel.step === "segnala" ? (
              <ReportReasons who={`@${panel.comment.author.username}`} disabled={panelBusy} onPick={(r) => report(panel.comment, r)} />
            ) : (
              <View style={{ gap: space[3] }}>
                <Txt variant="title">{panel.step === "blocca" ? `Bloccare @${panel.comment.author.username}?` : "Eliminare il commento?"}</Txt>
                <Txt variant="body" tone={color.paperDim}>
                  {panel.step === "blocca"
                    ? "Non vedrete più post, commenti e profilo l’uno dell’altro, e smetterete di seguirvi. Puoi sbloccare quando vuoi dalle Impostazioni."
                    : "Lo elimini per sempre."}
                </Txt>
                <Press
                  style={[styles.button, styles.danger]}
                  onPress={() => (panel.step === "blocca" ? block(panel.comment) : removeFromPanel(panel.comment))}
                  disabled={panelBusy}
                  accessibilityRole="button"
                >
                  {panelBusy ? <ActivityIndicator color={color.paper} /> : <Txt variant="label">{panel.step === "blocca" ? "Blocca" : "Elimina"}</Txt>}
                </Press>
                <Press style={[styles.button, styles.ghost]} onPress={() => setPanel({ ...panel, step: "menu" })} disabled={panelBusy} accessibilityRole="button">
                  <Txt variant="label">Annulla</Txt>
                </Press>
              </View>
            )}
          </ScrollView>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PanelRow({ icon, label, hint, danger, onPress }: { icon?: "cestino" | "segnala" | "blocca"; label: string; hint?: string; danger?: boolean; onPress: () => void }) {
  return (
    <Press style={styles.panelRow} onPress={onPress} accessibilityRole="button">
      {icon ? <Icon name={icon} size={22} color={danger ? color.matita : color.paper} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" tone={danger ? color.matita : color.paper}>
          {label}
        </Txt>
        {hint ? (
          <Txt variant="small" tone={color.paperFaint}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.sheet },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[4],
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  message: { textAlign: "center", marginTop: space[8], paddingHorizontal: space[5] },
  // Aree di tocco di almeno 44 punti anche per "Rispondi" ed "Elimina".
  rowActions: { flexDirection: "row", gap: space[4], marginTop: -space[2], marginBottom: -space[2] },
  small: { minHeight: 44, minWidth: 44, justifyContent: "center" },
  row: { flexDirection: "row", gap: space[3] },
  more: { width: 44, height: 44, marginRight: -space[3], marginTop: -space[2], alignItems: "center", justifyContent: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  input: { maxHeight: 120, paddingVertical: 11 },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.giallo,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { opacity: 0.4 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: color.scrim },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "85%",
    backgroundColor: color.sheet,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  panelRow: { flexDirection: "row", alignItems: "center", gap: space[4], backgroundColor: color.raised, borderRadius: radius.control, padding: space[4], minHeight: 56 },
  button: { borderRadius: radius.control, paddingVertical: 15, alignItems: "center", minHeight: 52, justifyContent: "center" },
  danger: { backgroundColor: color.matita },
  ghost: { backgroundColor: color.raised },
});
