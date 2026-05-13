import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import * as ImagePicker from 'expo-image-picker';

export async function pickImageFromLibrary(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Permesso galleria negato');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    allowsEditing: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}

export async function uploadFoodMedia(localUri: string, userId: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) return localUri;
  const res = await fetch(localUri);
  const blob = await res.blob();
  const ext = localUri.split('.').pop() || 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('food-media').upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('food-media').getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadAvatar(localUri: string, userId: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) return localUri;
  const res = await fetch(localUri);
  const blob = await res.blob();
  const path = `${userId}/avatar-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}
