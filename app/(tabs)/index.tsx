import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

type SignalData = {
  deviceId: string;
  triggered: boolean;
  value: number;
  timestamp: string;
};

export default function HomeScreen() {
  const [signal, setSignal] = useState<SignalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSignal = async () => {
    try {
      setError('');
      const response = await fetch('http://localhost:3000/signal');
      const data = await response.json();
      setSignal(data);
    } catch (err) {
      setError('Could not load signal from backend.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignal();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>ESP32 Signal Viewer</Text>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Device ID</Text>
          <Text style={styles.value}>{signal?.deviceId}</Text>

          <Text style={styles.label}>Triggered</Text>
          <Text style={styles.value}>{signal?.triggered ? 'Yes' : 'No'}</Text>

          <Text style={styles.label}>Value</Text>
          <Text style={styles.value}>{signal?.value}</Text>

          <Text style={styles.label}>Timestamp</Text>
          <Text style={styles.value}>{signal?.timestamp}</Text>
        </View>
      )}

      <Pressable style={styles.button} onPress={fetchSignal}>
        <Text style={styles.buttonText}>Refresh Signal</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f7fb',
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
    color: '#111827',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 10,
  },
  value: {
    fontSize: 18,
    color: '#111827',
    marginTop: 4,
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#ffffff',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  error: {
    textAlign: 'center',
    color: '#dc2626',
    fontSize: 16,
    marginBottom: 24,
  },
});