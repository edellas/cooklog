import { ProfileView } from '../../src/screens/ProfileView';
import { useSession } from '../../src/state/session';

export default function MyProfileTab() {
  const { me } = useSession();
  return me ? <ProfileView username={me.username} /> : null;
}
