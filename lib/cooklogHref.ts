import type { Href } from 'expo-router';

export function hrefRecipeDetail(id: string): Href {
  return `/recipe/${id}` as Href;
}

export function hrefRecipeEdit(id: string): Href {
  return `/recipe/${id}/edit` as Href;
}
