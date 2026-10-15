/* Media della modalità demo: foto da Pixabay (modificate), video CC0 di MDN e uno di pubblico dominio. Crediti in assets/demo/CREDITI.md. */

export const DEMO_MEDIA: Record<string, number> = {
  'avocado': require('../../assets/demo/avocado.jpg'),
  'bimba-fiori': require('../../assets/demo/bimba-fiori.jpg'),
  'bimbo': require('../../assets/demo/bimbo.jpg'),
  'borgo': require('../../assets/demo/borgo.jpg'),
  'candele': require('../../assets/demo/candele.jpg'),
  'cane-bagno': require('../../assets/demo/cane-bagno.jpg'),
  'cane': require('../../assets/demo/cane.jpg'),
  'cavallo': require('../../assets/demo/cavallo.jpg'),
  'ciliegie': require('../../assets/demo/ciliegie.jpg'),
  'cinema': require('../../assets/demo/cinema.mp4'),
  'cinqueterre': require('../../assets/demo/cinqueterre.jpg'),
  'citta': require('../../assets/demo/citta.jpg'),
  'colori': require('../../assets/demo/colori.jpg'),
  'danza': require('../../assets/demo/danza.jpg'),
  'fiore': require('../../assets/demo/fiore.mp4'),
  'gatto-neve': require('../../assets/demo/gatto-neve.jpg'),
  'gatto': require('../../assets/demo/gatto.jpg'),
  'lago': require('../../assets/demo/lago.jpg'),
  'lava-clip': require('../../assets/demo/lava-clip.mp4'),
  'lava': require('../../assets/demo/lava.jpg'),
  'mercato': require('../../assets/demo/mercato.jpg'),
  'monaco': require('../../assets/demo/monaco.jpg'),
  'montagne': require('../../assets/demo/montagne.jpg'),
  'orso': require('../../assets/demo/orso.jpg'),
  'palme': require('../../assets/demo/palme.jpg'),
  'pappagalli': require('../../assets/demo/pappagalli.jpg'),
  'ritratto': require('../../assets/demo/ritratto.jpg'),
  'selfie': require('../../assets/demo/selfie.jpg'),
  'sposi': require('../../assets/demo/sposi.jpg'),
  'squalo': require('../../assets/demo/squalo.jpg'),
  'strada': require('../../assets/demo/strada.jpg'),
  'sub': require('../../assets/demo/sub.jpg'),
  'succo': require('../../assets/demo/succo.jpg'),
  'traghetto': require('../../assets/demo/traghetto.jpg'),
  'tramonto': require('../../assets/demo/tramonto.jpg'),
  'tulipani': require('../../assets/demo/tulipani.jpg'),
};

/** Risolve `demo:<nome>` nell'asset locale; gli altri src sono URL. */
export function resolveMedia(src: string): string | number {
  return src.startsWith('demo:') ? (DEMO_MEDIA[src.slice(5)] ?? src) : src;
}
