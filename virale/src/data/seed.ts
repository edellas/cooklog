import type { Author, MediaItem } from '../types';

/**
 * Contenuti della modalità demo. Persone, didascalie e commenti sono inventati;
 * le foto e i video sono quelli elencati in assets/demo/CREDITI.md.
 */

export type SeedCreator = Author & { bio: string; followers: number; following: number };

const c = (username: string, displayName: string, bio: string, followers: number, following: number): SeedCreator => ({
  id: `demo-${username}`,
  username,
  displayName,
  bio,
  followers,
  following,
});

export const CREATORS: SeedCreator[] = [
  c('giulia.viaggia', 'Giulia Ferri', 'Treni regionali, paesi piccoli, colazioni lunghe.', 48210, 312),
  c('marta.ride', 'Marta Conti', 'Ridere è il mio cardio.', 12870, 540),
  c('lupo.e.biscotto', 'Lupo & Biscotto', 'Due cani, un divano, zero regole.', 91340, 88),
  c('ballaro.sabato', 'Salvo Lo Monaco', 'Il mercato di Ballarò, ogni sabato dalle 7.', 7350, 201),
  c('nico.statale', 'Nicola Rinaldi', 'Moto, curve e autunni in montagna.', 22410, 419),
  c('fabio.meno18', 'Fabio Esposito', 'Istruttore sub a Ustica.', 15630, 173),
  c('lucia.e.i.bimbi', 'Lucia Marino', 'Mamma di due. Fotografo tutto, ricordo poco.', 30980, 610),
  c('etna.di.notte', 'Agata Russo', 'Guida vulcanologica. Le colate le vedo da vicino.', 64120, 95),
  c('gatti.di.casa', 'Elena Bassi', 'Due gatti offesi a tempo pieno.', 120450, 34),
  c('sara.danza', 'Sara Galli', 'Danza contemporanea, Torino.', 9870, 402),
  c('orto.lento', 'Paolo Neri', 'Orto botanico in timelapse.', 5420, 77),
  c('cineteca.minima', 'Cineteca Minima', 'Cinema di una volta, un minuto al giorno.', 18760, 12),
  c('carlo.in.viaggio', 'Carlo De Santis', 'Kathmandu, Hanoi, Bari.', 26300, 288),
  c('fra.colazione', 'Francesca Riva', 'Colazioni delle 10:30.', 11140, 503),
  c('maremma.cavalli', 'Tommaso Bini', 'Allevo cavalli in Maremma.', 8030, 145),
  c('luca.in.quota', 'Luca Fabbri', 'Rifugi, laghi, vesciche.', 33990, 260),
  c('bianca.pellicola', 'Bianca Leone', 'Solo bianco e nero.', 6210, 330),
  c('anna.e.dario', 'Anna e Dario', 'Sposi da sabato scorso.', 2140, 380),
];

export const creator = (username: string) => CREATORS.find((x) => x.username === username)!;

const img = (name: string): MediaItem => ({ kind: 'image', src: `demo:${name}`, width: 720, height: 1080 });
const vid = (name: string, durationMs: number): MediaItem => ({ kind: 'video', src: `demo:${name}`, width: 480, height: 720, durationMs });

export type SeedPost = {
  id: string;
  username: string;
  media: MediaItem[];
  caption: string;
  likes: number;
  comments: string[];
  saves: number;
  shares: number;
  /** Ore fa. */
  age: number;
};

export const SEED_POSTS: SeedPost[] = [
  { id: 'p-cinqueterre', username: 'giulia.viaggia', media: [img('cinqueterre'), img('borgo')], caption: 'Manarola alle 7, prima dei turisti. La seconda è Cortina, stessa settimana.', likes: 4120, comments: ['Mi hai fatto venire voglia di partire stasera', 'La luce delle 7 non perdona nessuno', 'Che treno hai preso?'], saves: 980, shares: 640, age: 30 },
  { id: 'p-selfie', username: 'marta.ride', media: [img('selfie')], caption: 'Quando ti dicono che domani la copertina potresti essere tu.', likes: 2310, comments: ['Questa faccia è tutta la mia settimana', 'Il rosso ti sta benissimo'], saves: 120, shares: 410, age: 5 },
  { id: 'p-cani', username: 'lupo.e.biscotto', media: [img('cane-bagno'), img('cane')], caption: 'Bagno finito. Biscotto non era d’accordo, Lupo si è offeso per solidarietà.', likes: 8840, comments: ['La seconda foto è un giudizio universale', 'Biscotto presidente'], saves: 760, shares: 1290, age: 4 },
  { id: 'p-mercato', username: 'ballaro.sabato', media: [img('mercato'), img('ciliegie'), img('colori')], caption: 'Sabato a Ballarò: ciliegie di Bagheria a 4 euro, sorrisi gratis.', likes: 960, comments: ['Mi manca Palermo', 'Le ciliegie di giugno valgono il viaggio'], saves: 210, shares: 88, age: 7 },
  { id: 'p-strada', username: 'nico.statale', media: [img('strada')], caption: 'Statale 38, ottobre. Il bosco ha cambiato colore in tre giorni.', likes: 1780, comments: ['Che strada è esattamente?', 'Ottobre è il mese più bello per andare in moto'], saves: 430, shares: 150, age: 3 },
  { id: 'p-sub', username: 'fabio.meno18', media: [img('sub'), img('squalo')], caption: 'Meno 18 metri a Ustica. Lei è passata a salutare e se n’è andata subito.', likes: 3020, comments: ['Io sarei risalito in 4 secondi', 'Che visibilità oggi!'], saves: 540, shares: 300, age: 6 },
  { id: 'p-bimbi', username: 'lucia.e.i.bimbi', media: [img('bimba-fiori'), img('bimbo')], caption: 'Lei annusa ogni fiore. Lui li vuole mangiare.', likes: 2650, comments: ['Il cappellino giallo vince tutto'], saves: 310, shares: 180, age: 2 },
  { id: 'p-lava', username: 'etna.di.notte', media: [vid('lava-clip', 6000), img('lava')], caption: 'Etna stanotte, dal versante sud. Il calore si sente a 50 metri.', likes: 6930, comments: ['Paura e meraviglia insieme', 'Da quanto tempo non si vedeva così?'], saves: 1220, shares: 980, age: 8 },
  { id: 'p-gatti', username: 'gatti.di.casa', media: [img('gatto-neve'), img('gatto')], caption: 'Prima neve. Prima espressione offesa della stagione.', likes: 12400, comments: ['Offesissima', 'Si vede che pensa “chi ha fatto questo”'], saves: 1840, shares: 2100, age: 1 },
  { id: 'p-danza', username: 'sara.danza', media: [img('danza')], caption: 'Prova generale. Domani si va in scena.', likes: 1410, comments: ['Che movimento!'], saves: 160, shares: 70, age: 9 },
  { id: 'p-fiore', username: 'orto.lento', media: [vid('fiore', 5000)], caption: 'Portulaca: si apre in tre ore, qui in cinque secondi.', likes: 880, comments: ['Ipnotico', 'Rifallo con un girasole'], saves: 240, shares: 60, age: 10 },
  { id: 'p-cinema', username: 'cineteca.minima', media: [vid('cinema', 6000)], caption: 'La signora Venerdì (1940): la battuta più veloce della storia del cinema.', likes: 1990, comments: ['Che ritmo, altro che i film di oggi'], saves: 520, shares: 230, age: 11 },
  { id: 'p-monaco', username: 'carlo.in.viaggio', media: [img('monaco'), img('candele')], caption: 'Kathmandu, la sera del festival delle luci.', likes: 2280, comments: ['La luce della seconda è pazzesca'], saves: 390, shares: 140, age: 12 },
  { id: 'p-colazione', username: 'fra.colazione', media: [img('succo'), img('avocado')], caption: 'Colazione delle 10:30, perché oggi si può.', likes: 640, comments: ['Avocado o arancia? Entrambi'], saves: 95, shares: 20, age: 3 },
  { id: 'p-cavallo', username: 'maremma.cavalli', media: [img('cavallo')], caption: 'Furia ha scoperto il fiume. Non esce più.', likes: 1530, comments: ['Che faccia felice'], saves: 140, shares: 90, age: 5 },
  { id: 'p-quota', username: 'luca.in.quota', media: [img('montagne'), img('lago')], caption: 'Sveglia alle 4, rifugio alle 9, lago alle 11. Gambe finite, testa nuova.', likes: 2740, comments: ['Che lago è?', 'La seconda sembra dipinta'], saves: 880, shares: 210, age: 14 },
  { id: 'p-ritratto', username: 'bianca.pellicola', media: [img('ritratto')], caption: 'Ritratto a Chiara, luce di una finestra sola.', likes: 990, comments: ['Il bianco e nero le sta benissimo'], saves: 260, shares: 40, age: 6 },
  { id: 'p-sposi', username: 'anna.e.dario', media: [img('sposi')], caption: 'Sabato abbiamo detto sì. Sotto le lucine del vicolo.', likes: 3410, comments: ['Auguri!!!', 'Bellissimi'], saves: 210, shares: 120, age: 20 },
];

/** Copertine passate (giorno → post), per l'Archivio. Più recente per prima. */
export const PAST_COVERS: { daysAgo: number; postId: string; totalEntries: number; totalViews: number }[] = [
  { daysAgo: 1, postId: 'p-gatti', totalEntries: 11842, totalViews: 1830450 },
  { daysAgo: 2, postId: 'p-lava', totalEntries: 10970, totalViews: 1712300 },
  { daysAgo: 3, postId: 'p-sub', totalEntries: 10215, totalViews: 1604110 },
  { daysAgo: 4, postId: 'p-cani', totalEntries: 9820, totalViews: 1490020 },
  { daysAgo: 5, postId: 'p-quota', totalEntries: 9310, totalViews: 1388700 },
  { daysAgo: 6, postId: 'p-ritratto', totalEntries: 8890, totalViews: 1302510 },
  { daysAgo: 7, postId: 'p-monaco', totalEntries: 8420, totalViews: 1251930 },
];

/** La copertina di oggi in demo: il post di @giulia.viaggia. */
export const TODAY_COVER = { postId: 'p-cinqueterre', totalEntries: 12408, totalViews: 1964230 };

/** Account che l'utente demo segue già, per riempire "Seguiti". */
export const DEMO_FOLLOWING = ['gatti.di.casa', 'etna.di.notte', 'lucia.e.i.bimbi', 'nico.statale', 'giulia.viaggia'];

/** Commentatori di contorno. */
export const COMMENTERS = ['ale.rossi', 'chiara.b', 'davide_m', 'irene.lombardi', 'teo.sartori', 'giorgia.p'];

/** Prima uscita: da qui si conta il numero della copertina ("N. 288"). */
export const LAUNCH_DAY = '2026-01-01';
