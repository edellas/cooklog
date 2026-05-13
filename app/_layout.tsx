import { CooklogColors } from '@/constants/cooklogTheme';
import { RecipeProvider } from '@/contexts/RecipeContext';
import { AuthLoadingScreen } from '@/src/screens/AuthLoadingScreen';
import { AuthProvider, useAuth } from '@/src/providers/AuthProvider';
import { DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

const cooklogLightTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: CooklogColors.primary,
    background: CooklogColors.background,
    card: CooklogColors.backgroundElevated,
    text: CooklogColors.text,
    border: CooklogColors.border,
    notification: CooklogColors.accent,
  },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const navigationTheme = cooklogLightTheme;

  return (
    <AuthProvider>
      <RecipeProvider>
        <ThemeProvider value={navigationTheme}>
          <AuthGate />
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        </ThemeProvider>
      </RecipeProvider>
    </AuthProvider>
  );
}

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const { isReady, isSupabaseConfigured, isDemoMode, user, interests } = useAuth();

  useEffect(() => {
    if (!isReady) return;
    const current = String(segments[0] ?? '');

    if (!isSupabaseConfigured && !isDemoMode) return;

    if (!user && current !== 'login' && current !== 'register') {
      router.replace('/login' as Href);
      return;
    }

    if (user && interests.length < 3 && current !== 'onboarding-interests') {
      router.replace('/onboarding-interests' as Href);
      return;
    }

    if (user && (current === 'login' || current === 'register' || current === 'onboarding-interests')) {
      router.replace('/' as Href);
    }
  }, [interests.length, isDemoMode, isReady, isSupabaseConfigured, router, segments, user]);

  if (!isReady) return null;
  if (!isSupabaseConfigured && !isDemoMode) return <AuthLoadingScreen />;

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding-interests" options={{ title: 'Interessi' }} />
      <Stack.Screen name="comments/[postId]" options={{ title: 'Commenti' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Modifica profilo' }} />
      <Stack.Screen name="paywall" options={{ title: 'Cooklog Pro' }} />
      <Stack.Screen name="recipe" options={{ headerShown: false }} />
    </Stack>
  );
}
