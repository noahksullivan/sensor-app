import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';

const API_BASE = 'https://sensor-backend-1rk2.onrender.com';
const DEVICE_ID = 'esp32-001';
const CHART_WIDTH = Dimensions.get('window').width - 64;
const CHART_POINT_SPACING = 28;   // horizontal pixels per point
const CHART_LABEL_EVERY = 15;     // only show every 15th timestamp label
const SIGNAL_LIMIT = 600;         // last 600 one-second points
const REFRESH_MS = 2000;          // poll every 2 seconds
const ON_THRESHOLD_AMPS = 0.5;

type SignalPoint = {
  deviceId: string;
  triggered: boolean;
  value: number;
  timestamp: string;
};

type AnnotatedSignalPoint = SignalPoint & {
  isOn: boolean;
  onTimeSeconds: number;
  completedRunDurationSeconds: number | null;
};

const formatDuration = (totalSeconds: number) => {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const annotateSignals = (
  points: SignalPoint[],
  thresholdAmps: number
): AnnotatedSignalPoint[] => {
  let runStartMs: number | null = null;
  let lastOnDurationSeconds = 0;

  return points.map((point) => {
    const pointMs = new Date(point.timestamp).getTime();
    const isOn = point.value >= thresholdAmps;

    if (isOn) {
      if (runStartMs === null) {
        runStartMs = pointMs;
      }

      const onTimeSeconds = Math.max(
        0,
        Math.round((pointMs - runStartMs) / 1000)
      );

      lastOnDurationSeconds = onTimeSeconds;

      return {
        ...point,
        isOn: true,
        onTimeSeconds,
        completedRunDurationSeconds: null,
      };
    }

    const completedRunDurationSeconds =
      runStartMs !== null ? lastOnDurationSeconds : null;

    runStartMs = null;
    lastOnDurationSeconds = 0;

    return {
      ...point,
      isOn: false,
      onTimeSeconds: 0,
      completedRunDurationSeconds,
    };
  });
};

export default function HomeScreen() {
  const [signals, setSignals] = useState<SignalPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSignal = async () => {
    try {
      setError('');

      const response = await fetch(
        `${API_BASE}/signals?deviceId=${DEVICE_ID}&limit=${SIGNAL_LIMIT}`
      );

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error('Backend did not return an array of signal points.');
      }

      const sortedData = data
        .slice()
        .sort(
          (a: SignalPoint, b: SignalPoint) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

      setSignals(sortedData);
    } catch (err) {
      setError('Could not load signal data from backend.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignal();

    const interval = setInterval(() => {
      fetchSignal();
    }, REFRESH_MS);

    return () => clearInterval(interval);
  }, []);

  const annotatedSignals = annotateSignals(signals, ON_THRESHOLD_AMPS);

  const latestPoint =
    annotatedSignals.length > 0
      ? annotatedSignals[annotatedSignals.length - 1]
      : null;

  const isCurrentlyOn = latestPoint?.isOn ?? false;

  const latestRunTimeText = latestPoint
    ? latestPoint.isOn
      ? formatDuration(latestPoint.onTimeSeconds)
      : latestPoint.completedRunDurationSeconds !== null
        ? formatDuration(latestPoint.completedRunDurationSeconds)
        : '0:00'
    : '0:00';

  const dynamicChartWidth = Math.max(
    CHART_WIDTH,
    signals.length * CHART_POINT_SPACING
  );

  const chartLabels =
    signals.length > 0
      ? signals.map((point, index) => {
          if (index % CHART_LABEL_EVERY !== 0 && index !== signals.length - 1) {
            return '';
          }

          const date = new Date(point.timestamp);
          const minutes = String(date.getMinutes()).padStart(2, '0');
          const seconds = String(date.getSeconds()).padStart(2, '0');
          return `${minutes}:${seconds}`;
        })
      : [''];

  const chartValues =
    signals.length > 0 ? signals.map((point) => point.value) : [0];

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>ESP32 Signal Viewer</Text>

        {loading ? (
          <ActivityIndicator size="large" />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Latest Reading</Text>

              <Text style={styles.label}>Device ID</Text>
              <Text style={styles.value}>{latestPoint?.deviceId ?? 'N/A'}</Text>

              <Text style={styles.label}>Status</Text>
              <Text style={styles.value}>
                {latestPoint ? (latestPoint.isOn ? 'ON' : 'OFF') : 'N/A'}
              </Text>

              <Text style={styles.label}>Current Value</Text>
              <Text style={styles.value}>
                {latestPoint ? `${latestPoint.value.toFixed(3)} A` : 'N/A'}
              </Text>

              <Text style={styles.label}>Timestamp</Text>
              <Text style={styles.value}>
                {latestPoint ? formatTimestamp(latestPoint.timestamp) : 'N/A'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current vs Time</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                contentContainerStyle={styles.chartScrollContent}
              >
                <LineChart
                  data={{
                    labels: chartLabels,
                    datasets: [
                      {
                        data: chartValues,
                      },
                    ],
                  }}
                  width={dynamicChartWidth}
                  height={220}
                  yAxisLabel=""
                  yAxisSuffix=""
                  chartConfig={{
                    backgroundColor: '#ffffff',
                    backgroundGradientFrom: '#ffffff',
                    backgroundGradientTo: '#ffffff',
                    decimalPlaces: 2,
                    color: (opacity = 1) => `rgba(37, 99, 235, ${opacity})`,
                    labelColor: (opacity = 1) => `rgba(17, 24, 39, ${opacity})`,
                    propsForDots: {
                      r: '3',
                      strokeWidth: '1',
                      stroke: '#2563eb',
                    },
                  }}
                  style={styles.chart}
                />
              </ScrollView>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Pump Status</Text>

              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusBadge,
                    isCurrentlyOn ? styles.statusBadgeOn : styles.statusBadgeOff,
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {isCurrentlyOn ? 'ON' : 'OFF'}
                  </Text>
                </View>

                <Text style={styles.statusText}>
                  Threshold: {ON_THRESHOLD_AMPS.toFixed(1)} A
                </Text>
              </View>

              <Text style={styles.statusDetail}>
                {isCurrentlyOn
                  ? `Pump has been ON for ${latestRunTimeText}`
                  : `Pump is currently OFF${
                      latestPoint?.completedRunDurationSeconds !== null
                        ? ` • Last run time: ${latestRunTimeText}`
                        : ''
                    }`}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent Readings</Text>

              {annotatedSignals.length === 0 ? (
                <Text style={styles.emptyText}>No readings available.</Text>
              ) : (
                annotatedSignals
                  .slice()
                  .reverse()
                  .map((point, index) => (
                    <View
                      key={`${point.timestamp}-${index}`}
                      style={[
                        styles.readingRow,
                        index !== annotatedSignals.length - 1 &&
                          styles.readingRowBorder,
                      ]}
                    >
                      <Text style={styles.readingTimestamp}>
                        {formatTimestamp(point.timestamp)}
                      </Text>
                      <Text style={styles.readingText}>
                        Current: {point.value.toFixed(3)} A
                      </Text>
                      <Text style={styles.readingText}>
                        Status: {point.isOn ? 'ON' : 'OFF'}
                      </Text>
                      <Text style={styles.readingText}>
                        On Time:{' '}
                        {point.isOn
                          ? formatDuration(point.onTimeSeconds)
                          : point.completedRunDurationSeconds !== null
                            ? `${formatDuration(point.completedRunDurationSeconds)} (completed run)`
                            : '0:00'}
                      </Text>
                    </View>
                  ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f7fb',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
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
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
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
  error: {
    textAlign: 'center',
    color: '#dc2626',
    fontSize: 16,
    marginBottom: 24,
  },
  chart: {
    marginTop: 8,
    borderRadius: 12,
  },
  chartScrollContent: {
    paddingRight: 12,
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
  },
  readingRow: {
    paddingVertical: 12,
  },
  readingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  readingTimestamp: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  readingText: {
    fontSize: 15,
    color: '#374151',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusBadgeOn: {
    backgroundColor: '#16a34a',
  },
  statusBadgeOff: {
    backgroundColor: '#dc2626',
  },
  statusBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  statusText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '600',
  },
  statusDetail: {
    fontSize: 15,
    color: '#111827',
    marginTop: 4,
  },
});