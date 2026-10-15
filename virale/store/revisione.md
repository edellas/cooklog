# Note per la revisione (App Review e Google Play)

Da incollare in **App Store Connect → Versione → Informazioni per la revisione dell'app → Note**
e in **Play Console → Contenuti dell'app → Accesso alle app** ("Tutte le funzionalità sono disponibili
senza restrizioni di accesso").

---

## Accesso
Non servono credenziali. L'app crea un account anonimo al primo avvio: basta scegliere un nome utente,
spuntare la casella dei Termini e toccare "Entra". Non chiediamo email, telefono o password.

Note: a new account cannot vote in the daily contest for its first 24 hours (anti-fraud).
Every other feature — browsing, posting photos/videos, commenting, liking, following, reporting,
blocking and deleting the account — works immediately.

## User-generated content (Guideline 1.2)
- Terms of Service and Community Guidelines must be accepted before creating an account
  (checkbox on the sign-up screen). Minimum age 14.
- Report: "···" under any post → "Segnala post" → choose a reason. The post disappears for the
  reporter immediately; posts reported by 3 different people are hidden for everyone until reviewed.
- Block: "···" under a post → "Blocca @utente", or from the user's profile. Blocked users' posts,
  comments and profile disappear for both sides immediately.
- Moderation: reports are reviewed by our moderators within 24 hours from an in-app queue
  (remove content, ban the author). Contact: <OWNER.email>.

## Account deletion (Guideline 5.1.1(v))
Profilo → icona impostazioni (in alto a destra) → "Elimina account" → tocca di nuovo per confermare.
Deletes profile, posts, media files, comments, likes, saves, follows and contest entries.
Web page for deletion requests: <sito>/eliminazione-account.html

## Other
- No ads, no tracking, no in-app purchases.
- Camera and photo library are used only to pick what the user publishes.
- Encryption: only standard HTTPS (ITSAppUsesNonExemptEncryption = NO).
