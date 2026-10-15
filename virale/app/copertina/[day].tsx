import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { color } from '../../src/design/tokens';
import { CoverView } from '../../src/screens/CoverView';
import { getArchive } from '../../src/services/api';
import type { Cover } from '../../src/types';

export default function ArchivedCover() {
  const { day } = useLocalSearchParams<{ day: string }>();
  const [cover, setCover] = useState<Cover | null>(null);
  useEffect(() => {
    void getArchive().then((all) => setCover(all.find((c) => c.featuredOn === day) ?? null));
  }, [day]);
  if (!cover) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.canvas }}>
        <ActivityIndicator color={color.giallo} />
      </View>
    );
  }
  return <CoverView cover={cover} isToday={false} reveal={false} />;
}
