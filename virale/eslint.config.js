// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Le funzioni Supabase girano su Deno (import "npm:..."): si controllano con deno check, non qui.
    ignores: ['dist/*', 'supabase/functions/**'],
  },
]);
