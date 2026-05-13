import { EditRecipeScreen } from '@/screens/EditRecipeScreen';

export const options = {
  title: 'Nuova ricetta',
};

export default function NewRecipeRoute() {
  return <EditRecipeScreen mode="create" />;
}
