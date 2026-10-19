// Estende app.json. Per le notifiche push su Android serve il file google-services.json di Firebase:
// su expo.dev lo si carica come variabile d'ambiente di tipo "file" chiamata GOOGLE_SERVICES_JSON
// (vedi PUBBLICARE.md). Senza, la build riesce lo stesso: l'app funziona ma su Android non riceve notifiche
// (e lo dice nelle Impostazioni).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
});
