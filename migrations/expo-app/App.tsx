import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Button } from '@orbit/ui-native';

/**
 * Migration target: Expo entry point.
 *
 * Boots the session (SecureStore-backed token), then renders the conversation
 * list from @orbit/api-client. E2EE plaintext decrypts on-device and feeds the
 * local search index exactly like the web client.
 */
interface Health {
  status: string;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080'}/v1/health`);
      setHealth((await res.json()) as Health);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to reach the API');
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.card}>
        <Text style={styles.title}>Orbit Chat</Text>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : health ? (
          <Text style={styles.status}>API: {health.status}</Text>
        ) : (
          <ActivityIndicator />
        )}
        <Button label="Reconnect" onPress={loadHealth} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FC', justifyContent: 'center', padding: 24 },
  card: { gap: 12, alignItems: 'flex-start' },
  title: { fontSize: 24, fontWeight: '700', color: '#171A2B' },
  status: { fontSize: 14, color: '#5F6478' },
  error: { fontSize: 14, color: '#C33B52' },
});
