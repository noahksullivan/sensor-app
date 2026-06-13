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
const CHART_WIDTH = Dimensions.get('window').width - 64;
const CHART_HEIGHT = 220;
const CHART_SEGMENTS = 4;
const Y_AXIS_WIDTH = 56;
const CHART_POINT_SPACING = 28;
const CHART_LABEL_EVERY = 60;
const REFRESH_MS = 2000;
const ON_THRESHOLD_AMPS = 0.5;

type SignalPoint = {
  deviceId: string;
  triggered: boolean;
  value: number;
  timestamp: string;
};

type DeviceConfig = {
  deviceId: string;
  label: string;
};

type AnnotatedSignalPoint = SignalPoint & {
  isOn: boolean;
  onTimeSeconds: number;
  completedRunDurationSeconds: number | null;
};

const FALLBACK_DEVICES: DeviceConfig[] = [
  { deviceId: 'esp32-001', label: 'Pump 1' },
  { deviceId: 'esp32-002', label: 'Pump 2' },
];

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

const formatChartLabel = (
  timestamp: string,
  previousTimestamp?: string | null,
  forceFullDate = false
) => {
  const date = new Date(timestamp);
  const previousDate = previousTimestamp ? new Date(previousTimestamp) : null;

  const dayChanged =
    !previousDate ||
    date.getFullYear() !== previousDate.getFullYear() ||
    date.getMonth() !== previousDate.getMonth() ||
    date.getDate() !== previousDate.getDate();

  if (forceFullDate || dayChanged) {
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const buildYAxisLabels = (values: number[], segments: number) => {
  const maxValue = Math.max(...values, 0.1);

  return Array.from({ length: segments + 1 }, (_, index) => {
    const value = (maxValue / segments) * (segments - index);
    return value.toFixed(2);
  });
};

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

function DevicePanel({
  device,
  signals,
}: {
  device: DeviceConfig;
  signals: SignalPoint[];
}) {
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
          const previousTimestamp =
            index > 0 ? signals[index - 1].timestamp : null;

          const currentDate = new Date(point.timestamp);
          const previousDate = previousTimestamp
            ? new Date(previousTimestamp)
            : null;

          const dayChanged =
            !previousDate ||
            currentDate.getFullYear() !== previousDate.getFullYear() ||
            currentDate.getMonth() !== previousDate.getMonth() ||
            currentDate.getDate() !== previousDate.getDate();

          const shouldShowLabel =
            index === 0 ||
            index === signals.length - 1 ||
            dayChanged ||
            index % CHART_LABEL_EVERY === 0;

          if (!shouldShowLabel) {
            return '';
          }

          return formatChartLabel(
            point.timestamp,
            previousTimestamp,
            dayChanged
          );
        })
      : [''];

  const chartValues =
    signals.length > 0 ? signals.map((point) => point.value) : [0];

  const yAxisLabels = buildYAxisLabels(chartValues, CHART_SEGMENTS);

  return (
    <View style={styles.deviceSection}>
      <Text style={styles.deviceHeader}>{device.label}</Text>
      <Text style={styles.deviceSubheader}>{device.deviceId}</Text>

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

        <View style={styles.chartRow}>
          <View style={styles.yAxisColumn}>
            {yAxisLabels.map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.yAxisLabelText}>
                {label}
              </Text>
            ))}
          </View>

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
              height={CHART_HEIGHT}
              withHorizontalLabels={false}
              segments={CHART_SEGMENTS}
              fromZero
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
                key={`${device.deviceId}-${point.timestamp}-${index}`}
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
    </View>
  );
}

export default function HomeScreen() {
  const [devices, setDevices] = useState<DeviceConfig[]>(FALLBACK_DEVICES);
  const [signalMap, setSignalMap] = useState<Record<string, SignalPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDevices = async () => {
    try {
      const response = await fetch(`${API_BASE}/devices`);

      if (!response.ok) {
        throw new Error(`Devices request failed with status ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        setDevices(data);
      }
    } catch (err) {
      console.error('Could not load device list, using fallback list.', err);
    }
  };

  const fetchSignals = async (deviceList: DeviceConfig[]) => {
    try {
      setError('');

      const responses = await Promise.all(
        deviceList.map(async (device) => {
          const response = await fetch(
            `${API_BASE}/signals?deviceId=${device.deviceId}`
          );

          if (!response.ok) {
            throw new Error(
              `Signals request failed for ${device.deviceId} with status ${response.status}`
            );
          }

          const data = await response.json();

          if (!Array.isArray(data)) {
            throw new Error(
              `Backend did not return an array for ${device.deviceId}.`
            );
          }

          const sortedData = data
            .slice()
            .sort(
              (a: SignalPoint, b: SignalPoint) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

          return {
            deviceId: device.deviceId,
            signals: sortedData,
          };
        })
      );

      const nextSignalMap: Record<string, SignalPoint[]> = {};
      responses.forEach(({ deviceId, signals }) => {
        nextSignalMap[deviceId] = signals;
      });

      setSignalMap(nextSignalMap);
    } catch (err) {
      setError('Could not load signal data from backend.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      await fetchDevices();
    };

    initialize();
  }, []);

  useEffect(() => {
    if (devices.length === 0) {
      return;
    }

    fetchSignals(devices);

    const interval = setInterval(() => {
      fetchSignals(devices);
    }, REFRESH_MS);

    return () => clearInterval(interval);
  }, [devices]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>ESP32 Signal Viewer</Text>

        {loading ? (
          <ActivityIndicator size="large" />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          devices.map((device) => (
            <DevicePanel
              key={device.deviceId}
              device={device}
              signals={signalMap[device.deviceId] ?? []}
            />
          ))
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
  deviceSection: {
    marginBottom: 32,
  },
  deviceHeader: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  deviceSubheader: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
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
  chartRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  yAxisColumn: {
    width: Y_AXIS_WIDTH,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
    paddingTop: 16,
    paddingBottom: 28,
    marginTop: 8,
  },
  yAxisLabelText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
    paddingRight: 8,
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