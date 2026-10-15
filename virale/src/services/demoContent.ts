import type { Post } from '../types';

/**
 * Contenuti della modalità demo: post di testo di creator fittizi, così l'anteprima
 * funziona senza server e senza scaricare file multimediali.
 */
const SEED: { username: string; name: string; body: string; caption: string; background: string }[] = [
  { username: 'giulia.viaggia', name: 'Giulia', body: 'Ho preso un treno a caso alle 6 di mattina.\nSono finita in un borgo con 40 abitanti 🏔️', caption: 'Giorno 1 del viaggio senza meta', background: '#0F2027,#2C5364' },
  { username: 'marco_beats', name: 'Marco', body: 'Ho campionato il rumore della moka e ci ho fatto una base 🎧☕', caption: 'Ditemi se la volete intera', background: '#41295A,#2F0743' },
  { username: 'nonna.rita', name: 'Nonna Rita', body: 'Mio nipote mi ha insegnato a usare questa app.\nCiao a tutti 👋❤️', caption: 'Primo video!', background: '#F7971E,#FFD200' },
  { username: 'luca.codes', name: 'Luca', body: 'Il mio codice funziona al primo colpo.\nNon so perché.\nHo paura. 😨', caption: '#programmatori', background: '#000000,#434343' },
  { username: 'sara_runs', name: 'Sara', body: '6 mesi fa non riuscivo a correre 1 km.\nOggi ho finito la mia prima mezza maratona 🏃‍♀️🥇', caption: 'Non mollate mai', background: '#11998E,#38EF7D' },
  { username: 'ale.fisica', name: 'Alessandro', body: 'Se ti allontani alla velocità della luce, il tempo per te rallenta.\nPer il tuo capo no. ⏳', caption: 'Fisica in 10 secondi', background: '#1A2980,#26D0CE' },
  { username: 'martina.draws', name: 'Martina', body: 'Ho disegnato ogni giorno per un anno.\nScorri per vedere il giorno 1 vs il giorno 365 ✏️', caption: 'Costanza > talento', background: '#DA4453,#89216B' },
  { username: 'pietro_gatti', name: 'Pietro', body: 'Il mio gatto ha imparato ad aprire il frigo.\nSiamo ufficialmente in pericolo 🐈', caption: 'Aiuto', background: '#FF512F,#DD2476' },
  { username: 'chiara.green', name: 'Chiara', body: '3 piante che non puoi uccidere nemmeno se ci provi 🌿\n1. Pothos 2. Sansevieria 3. Zamioculcas', caption: 'Pollice nero friendly', background: '#134E5E,#71B280' },
  { username: 'davide.storia', name: 'Davide', body: 'Cleopatra è vissuta più vicina all’allunaggio che alla costruzione delle piramidi. 🏛️🚀', caption: 'Lo sapevi?', background: '#3E5151,#DECBA4' },
  { username: 'fede_skate', name: 'Federica', body: 'Primo kickflip dopo 214 tentativi 🛹\nLe ginocchia non sono d’accordo', caption: 'Ci siamo!!!', background: '#8E2DE2,#4A00E0' },
  { username: 'tommy.money', name: 'Tommaso', body: 'Regola del 50/30/20:\n50% bisogni\n30% desideri\n20% risparmio 💸', caption: 'Finanza per chi odia la finanza', background: '#232526,#414345' },
  { username: 'elena.voce', name: 'Elena', body: 'Ho cantato in metro e un signore ha iniziato a fare la seconda voce 🎤🚇', caption: 'Milano sa sorprendere', background: '#C33764,#1D2671' },
  { username: 'paolo.diy', name: 'Paolo', body: 'Ho trasformato un pallet in una libreria con 12 euro 🔨📚', caption: 'Tutorial nei commenti', background: '#B79891,#94716B' },
  { username: 'irene.lingue', name: 'Irene', body: 'In finlandese “kalsarikännit” significa bere in mutande a casa senza voler uscire. 🇫🇮', caption: 'Parole intraducibili #3', background: '#2193B0,#6DD5ED' },
  { username: 'simone.astro', name: 'Simone', body: 'Stanotte alle 2:14 passa la Stazione Spaziale sopra l’Italia.\nAlzate gli occhi 🛰️', caption: 'Mettete la sveglia', background: '#0F0C29,#302B63' },
  { username: 'anna.balla', name: 'Anna', body: 'Ho provato il trend di ballo con mia madre.\nLei è più brava di me 💃', caption: 'Umiliata con affetto', background: '#EE0979,#FF6A00' },
  { username: 'matteo.prof', name: 'Matteo', body: 'Un mio studente ha consegnato il compito scritto in rima.\nGli ho dato 10. Anche la valutazione in rima. 📝', caption: 'Vita da prof', background: '#56AB2F,#A8E063' },
  { username: 'giorgia.mare', name: 'Giorgia', body: 'Pulito 300 metri di spiaggia stamattina con 20 sconosciuti 🌊\nDomenica prossima di nuovo?', caption: 'Chi viene?', background: '#00B4DB,#0083B0' },
  { username: 'riccardo.lol', name: 'Riccardo', body: 'Io: “Vado a letto presto”\nIo alle 3:47: guardando come si costruisce una canoa 🛶', caption: 'Ogni sera', background: '#614385,#516395' },
  { username: 'valentina.moda', name: 'Valentina', body: '5 outfit con un solo blazer 🧥\nIl quarto è il mio preferito', caption: 'Capsule wardrobe', background: '#E96443,#904E95' },
  { username: 'stefano.auto', name: 'Stefano', body: 'Ho restaurato la Panda di mio nonno.\n2 anni di lavoro. Parte al primo colpo 🚗', caption: 'Per te, nonno', background: '#4B79A1,#283E51' },
  { username: 'laura.psi', name: 'Laura', body: 'Se ti senti indietro rispetto agli altri: stai confrontando il tuo dietro le quinte con il loro trailer. 🎬', caption: 'Ricordatelo', background: '#FC5C7D,#6A82FB' },
  { username: 'nico.chef', name: 'Nicolò', body: 'Ho chiesto a 100 persone la loro canzone dell’estate.\nHa vinto una del 2003 ☀️🎶', caption: 'Risultati del sondaggio', background: '#F2994A,#F2C94C' },
];

export const DEMO_POSTS: Post[] = SEED.map((s, i) => ({
  id: `demo-post-${i + 1}`,
  authorId: `demo-creator-${s.username}`,
  authorUsername: s.username,
  authorName: s.name,
  mediaType: 'text',
  mediaUrl: null,
  body: s.body,
  caption: s.caption,
  background: s.background,
  createdAt: new Date(Date.UTC(2026, 0, 1, 8, i)).toISOString(),
}));

export const TEXT_BACKGROUNDS = [
  '#FF512F,#DD2476',
  '#8E2DE2,#4A00E0',
  '#11998E,#38EF7D',
  '#F7971E,#FFD200',
  '#1A2980,#26D0CE',
  '#000000,#434343',
];
