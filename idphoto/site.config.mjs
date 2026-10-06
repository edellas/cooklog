// ---------------------------------------------------------------------------
// The only file you need to edit before launching (see README.md).
// ---------------------------------------------------------------------------
export default {
  // Brand shown in the header, titles and emails.
  name: 'FotoPass',
  // Public URL of the site, no trailing slash (used for canonical/hreflang/sitemap).
  url: 'https://www.example.com',
  // Shown in the footer, privacy policy and terms.
  contactEmail: 'support@example.com',
  // Legal entity shown in the terms (with a Merchant of Record the MoR is the seller).
  legalName: 'FotoPass',

  // Displayed price per language. It MUST match the price of the product you
  // create on Polar / Stripe (the checkout always charges what is set there).
  price: {
    it: '6,99 €',
    en: '$7.99',
    es: '6,99 €',
    fr: '6,99 €',
  },

  // Refund promise shown on the site. Keep it only if you honour it.
  refundDays: 30,

  // Optional cookie-free analytics. Cloudflare Web Analytics token, or ''.
  cloudflareAnalyticsToken: '',

  // Default language served at the site root ("/"). Other languages live in /<lang>/.
  defaultLang: 'en',
  languages: ['en', 'it', 'es', 'fr'],
};
