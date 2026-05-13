import { CooklogColors } from '@/constants/cooklogTheme';
import { RecipeProvider } from '@/contexts/RecipeContext';
import { DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
    <RecipeProvider>
      <ThemeProvider value={navigationTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </RecipeProvider>
  );
}
