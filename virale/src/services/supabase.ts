import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);
/** Per i caricamenti in streaming dal disco (expo-file-system), che parlano direttamente con lo Storage. */
export const supabaseUrl = url ?? '';
export const supabaseAnonKey = anonKey ?? '';

export const supabase = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Sul telefono il rinnovo automatico della sessione gira solo con l'app aperta (come chiede Supabase):
// in background si ferma, tornando nell'app riparte subito (e rinnova il token se nel frattempo è scaduto).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
