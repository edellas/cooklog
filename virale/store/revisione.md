# Note per la revisione (App Review e Google Play)

Da incollare in **App Store Connect → Versione → Informazioni per la revisione dell'app → Note**
e in **Play Console → Contenuti dell'app → Accesso alle app** ("Tutte le funzionalità sono disponibili
senza restrizioni di accesso").

---

## Accesso
Account di prova già verificato (crealo prima di inviare l'app e scrivi qui le credenziali):
- Nome utente: `<revisore_apple>` — Password: `<password>`

Oppure il revisore può registrarsi: nome, cognome, data di nascita, nome utente e password (niente email).
After sign-up the app shows a one-time **recovery code**: with it, "Password dimenticata?" (Forgot password) on the
login screen lets users choose a new password without email. A new code can be created in Settings → "Codice di recupero".
Note for the reviewer: a new account must confirm its age within 7 days by uploading a photo of an ID
document and a selfie; until the deadline every feature works. New accounts cannot vote in the daily
contest for their first 24 hours (anti-fraud). Reporting, blocking and account deletion work immediately.
If automatic verification (Didit) is enabled, the app first asks for the user's explicit consent: Didit compares the
selfie with the photo on the ID (a single 1:1 face match, used only to check the age, images deleted after the
decision). Users who do not consent upload the photos instead and a person checks them.

## User-generated content (Guideline 1.2)
- Terms of Service and Community Guidelines must be accepted before creating an account
  (checkbox on the sign-up screen). Minimum age 14.
- Report: "···" under any post → "Segnala post" → choose a reason. The post disappears for the
  reporter immediately; posts reported by 3 different people are hidden for everyone until reviewed.
- Comments and profiles can be reported too: "···" next to a comment (or long press) → "Segnala commento";
  on a profile → "Segnala @username". A reported comment disappears for the reporter immediately.
- Block: "···" under a post → "Blocca @utente", or from the user's profile. Blocked users' posts,
  comments and profile disappear for both sides immediately.
- Moderation: reports are reviewed by our moderators within 24 hours from an in-app queue with two tabs
  (posts; comments and profiles): remove content, reset a profile, ban the author. The author is notified with
  the reason. Moderators get a push notification for new reports. Contact: <OWNER.email>.

## Account deletion (Guideline 5.1.1(v))
Profilo → icona impostazioni (in alto a destra) → "Elimina account" → tocca di nuovo per confermare.
Deletes profile, posts, media files, comments, likes, saves, follows and contest entries.
Web page for deletion requests: <sito>/eliminazione-account.html

## Other
- No ads, no tracking, no in-app purchases.
- Camera and photo library are used only to pick what the user publishes (and the profile photo).
- Push notifications are optional: permission is asked only after the user enters a post in the daily contest
  (or from Settings), never at launch. Categories can be turned off in Settings → "Notifiche".
- Encryption: only standard HTTPS (ITSAppUsesNonExemptEncryption = NO).
