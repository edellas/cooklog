import { useLocalSearchParams } from 'expo-router';

import { ProfileView } from '../../src/screens/ProfileView';

export default function UserScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return <ProfileView username={username} showBack />;
}
