import { CooklogColors } from '@/constants/cooklogTheme';
import { Stack } from 'expo-router';

export default function RecipeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTintColor: CooklogColors.primary,
        headerStyle: { backgroundColor: CooklogColors.backgroundElevated },
        headerTitleStyle: { fontWeight: '600', color: CooklogColors.text },
        contentStyle: { backgroundColor: CooklogColors.background },
      }}
    />
  );
}
