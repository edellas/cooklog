// Official photo specifications. Sizes in mm.
//   head:  chin-to-crown height range (top of hair included)
//   eyes:  eye line height measured from the bottom edge (optional)
//   top:   gap between crown and top edge (optional)
//   bg:    background colour used when the background is replaced
//   digital: pixel size / max KB of the downloadable digital file (optional,
//            default 600 dpi of the print size, max 2 MB)
//   glasses: 'no' (not allowed) | 'avoid' (allowed, discouraged) | 'ok'
//   source: official page to double-check the rules (shown on landing pages)
//
// !! Rules change. Before launching, re-check every `source` link once, and then
// !! every few months. A wrong spec means rejected photos and refunds.

const ICAO = { widthMm: 35, heightMm: 45, head: [32, 36], bg: '#ffffff' };
const US = { widthMm: 50.8, heightMm: 50.8, head: [25.4, 34.9], eyes: [28.6, 34.9], bg: '#ffffff', glasses: 'no' };
const ES = { widthMm: 26, heightMm: 32, head: [22.5, 25.5], top: [1.5, 3], bg: '#ffffff' };

export const SPECS = {
  'icao-35x45': { ...ICAO, glasses: 'avoid', digital: { w: 827, h: 1063, maxKB: 2000 } },
  'generic-35x40': { widthMm: 35, heightMm: 40, head: [28, 32], bg: '#ffffff', glasses: 'avoid' },

  'it-cie': { ...ICAO, glasses: 'avoid', digital: { w: 827, h: 1063, maxKB: 500 }, source: 'https://www.cartaidentita.interno.gov.it/' },
  'it-passport': { ...ICAO, glasses: 'avoid', source: 'https://www.poliziadistato.it/articolo/passaporto' },
  'it-permesso': { ...ICAO, glasses: 'avoid', source: 'https://www.poliziadistato.it/articolo/il-permesso-di-soggiorno' },
  'it-patente': { ...ICAO, glasses: 'avoid', source: 'https://www.ilportaledellautomobilista.it/' },

  'us-passport': { ...US, digital: { w: 1200, h: 1200, maxKB: 10000 }, source: 'https://travel.state.gov/content/travel/en/passports/how-apply/photos.html' },
  'us-visa': { ...US, digital: { w: 600, h: 600, maxKB: 240 }, source: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos.html' },
  'us-dv': { ...US, digital: { w: 600, h: 600, maxKB: 240 }, source: 'https://travel.state.gov/content/travel/en/us-visas/immigrate/diversity-visa-program-entry.html' },
  'in-visa': { ...US, digital: { w: 600, h: 600, maxKB: 240 }, glasses: 'avoid', source: 'https://indianvisaonline.gov.in/' },

  'uk-passport': { ...ICAO, head: [29, 34], bg: '#eeeeee', glasses: 'no', digital: { w: 900, h: 1157, maxKB: 10000 }, source: 'https://www.gov.uk/photos-for-passports' },
  'schengen-visa': { ...ICAO, glasses: 'avoid', source: 'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy_en' },
  'ca-visa': { ...ICAO, head: [31, 36], glasses: 'avoid', digital: { w: 827, h: 1063, maxKB: 4000 }, source: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/temporary-resident-visa-application-photograph-specifications.html' },
  'au-passport': { ...ICAO, glasses: 'no', source: 'https://www.passports.gov.au/getting-passport-how-it-works/photo-guidelines' },
  'cn-visa': { widthMm: 33, heightMm: 48, head: [28, 33], top: [3, 5], bg: '#ffffff', glasses: 'avoid', digital: { w: 420, h: 560, maxKB: 120 }, source: 'https://www.visaforchina.cn/' },

  'es-dni': { ...ES, glasses: 'avoid', source: 'https://www.dnielectronico.es/' },
  'es-pasaporte': { ...ES, glasses: 'avoid', source: 'https://www.dnielectronico.es/' },
  'es-tie': { ...ES, glasses: 'avoid', source: 'https://www.policia.es/' },
};

export const BACKGROUNDS = {
  white: '#ffffff',
  grey: '#eeeeee',
  blue: '#dbe7f3',
};

export function getSpec(id) {
  const spec = SPECS[id];
  if (!spec) throw new Error(`unknown spec ${id}`);
  return { id, ...spec };
}
