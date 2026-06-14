import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
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
const DASHBOARD_SIGNAL_LIMIT = 600;
const HISTORY_BUCKET_COUNT = 800;
const HISTORY_PAGE_SIZE = 200;

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

type SignalSummaryResponse = {
  deviceId: string;
  totalPoints: number;
  bucketCount: number;
  oldestTimestamp: string | null;
  latestTimestamp: string | null;
  points: SignalPoint[];
};

type SignalPageResponse = {
  deviceId: string;
  totalPoints: number;
  hasMore: boolean;
  nextBefore: string | null;
  readings: SignalPoint[];
};

const FALLBACK_DEVICES: DeviceConfig[] = [
  { deviceId: 'esp32-001', label: 'Hilltop' },
  { deviceId: 'esp32-002', label: 'Site 3' },
];

const formatDuration = (totalSeconds: number) => {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleString();
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

const buildChartLabels = (signals: SignalPoint[]) => {
  if (signals.length === 0) {
    return [''];
  }

  return signals.map((point, index) => {
    const previousTimestamp = index > 0 ? signals[index - 1].timestamp : null;

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

    return formatChartLabel(point.timestamp, previousTimestamp, dayChanged);
  });
};

const buildYAxisLabels = (values: number[], segments: number) => {
  const maxValue = Math.max(...values, 0.1);

  return Array.from({ length: segments + 1 }, (_, index) => {
    const value = (maxValue / segments) * (segments - index);
    return value.toFixed(2);
  });
};

const sortSignalsAscending = (points: SignalPoint[]) =>
  points
    .slice()
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

const mergeSignals = (
  existingSignals: SignalPoint[],
  incomingSignals: SignalPoint[]
) => {
  const mergedMap = new Map<string, SignalPoint>();

  existingSignals.forEach((point) => {
    mergedMap.set(point.timestamp, point);
  });

  incomingSignals.forEach((point) => {
    mergedMap.set(point.timestamp, point);
  });

  return sortSignalsAscending(Array.from(mergedMap.values())).slice(
    -DASHBOARD_SIGNAL_LIMIT
  );
};

function SignalChartCard({
  title,
  signals,
  helperText,
}: {
  title: string;
  signals: SignalPoint[];
  helperText?: string;
}) {
  const dynamicChartWidth = Math.max(
    CHART_WIDTH,
    signals.length * CHART_POINT_SPACING
  );

  const chartLabels = buildChartLabels(signals);
  const chartValues = signals.length > 0 ? signals.map((point) => point.value) : [0];
  const yAxisLabels = buildYAxisLabels(chartValues, CHART_SEGMENTS);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}

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
  );
}

function PumpStatusCard({
  isCurrentlyOn,
  latestRunTimeText,
  latestPoint,
}: {
  isCurrentlyOn: boolean;
  latestRunTimeText: string;
  latestPoint: AnnotatedSignalPoint | null;
}) {
  return (
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
  );
}

function DevicePanel({
  device,
  signals,
  onOpenRecentReadings,
}: {
  device: DeviceConfig;
  signals: SignalPoint[];
  onOpenRecentReadings: (device: DeviceConfig) => void;
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

  return (
    <View style={styles.deviceSection}>
      <Text style={styles.deviceHeader}>{device.label}</Text>
      <Text style={styles.deviceSubheader}>{device.deviceId}</Text>

      <SignalChartCard
        title="Current vs Time"
        signals={signals}
        helperText={`Dashboard view • last ${DASHBOARD_SIGNAL_LIMIT} seconds max`}
      />

      <PumpStatusCard
        isCurrentlyOn={isCurrentlyOn}
        latestRunTimeText={latestRunTimeText}
        latestPoint={latestPoint}
      />

      <Pressable
        style={({ pressed }) => [
          styles.card,
          styles.latestReadingCard,
          pressed && styles.latestReadingCardPressed,
        ]}
        onPress={() => onOpenRecentReadings(device)}
      >
        <View style={styles.latestReadingHeaderRow}>
          <Text style={styles.cardTitle}>Latest Reading</Text>
          <Text style={styles.openDetailsText}>Open full history →</Text>
        </View>

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
      </Pressable>
    </View>
  );
}

function RecentReadingsScreen({
  device,
  onBack,
}: {
  device: DeviceConfig;
  onBack: () => void;
}) {
  const [summarySignals, setSummarySignals] = useState<SignalPoint[]>([]);
  const [historyReadings, setHistoryReadings] = useState<SignalPoint[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');

  const annotatedHistoryReadings = useMemo(() => {
    const chronologicalReadings = historyReadings.slice().reverse();
    return annotateSignals(chronologicalReadings, ON_THRESHOLD_AMPS).reverse();
  }, [historyReadings]);

  const loadFirstPage = async () => {
    setLoading(true);
    setError('');

    try {
      const summaryParams = new URLSearchParams({
        deviceId: device.deviceId,
        bucketCount: String(HISTORY_BUCKET_COUNT),
      });

      const pageParams = new URLSearchParams({
        deviceId: device.deviceId,
        pageSize: String(HISTORY_PAGE_SIZE),
      });

      const [summaryResponse, pageResponse] = await Promise.all([
        fetch(`${API_BASE}/signals/summary?${summaryParams.toString()}`),
        fetch(`${API_BASE}/signals/page?${pageParams.toString()}`),
      ]);

      if (!summaryResponse.ok) {
        throw new Error(
          `Summary request failed with status ${summaryResponse.status}`
        );
      }

      if (!pageResponse.ok) {
        throw new Error(`Page request failed with status ${pageResponse.status}`);
      }

      const summaryData =
        (await summaryResponse.json()) as SignalSummaryResponse;
      const pageData = (await pageResponse.json()) as SignalPageResponse;

      setSummarySignals(sortSignalsAscending(summaryData.points ?? []));
      setHistoryReadings(pageData.readings ?? []);
      setTotalPoints(summaryData.totalPoints ?? 0);
      setNextBefore(pageData.nextBefore ?? null);
      setHasMore(Boolean(pageData.hasMore));
    } catch (err) {
      console.error(err);
      setError('Could not load full history for this device.');
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = async () => {
    if (!nextBefore || loadingOlder) {
      return;
    }

    setLoadingOlder(true);

    try {
      const params = new URLSearchParams({
        deviceId: device.deviceId,
        pageSize: String(HISTORY_PAGE_SIZE),
        before: nextBefore,
      });

      const response = await fetch(`${API_BASE}/signals/page?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Page request failed with status ${response.status}`);
      }

      const pageData = (await response.json()) as SignalPageResponse;

      setHistoryReadings((previous) => [...previous, ...(pageData.readings ?? [])]);
      setNextBefore(pageData.nextBefore ?? null);
      setHasMore(Boolean(pageData.hasMore));
    } catch (err) {
      console.error(err);
      setError('Could not load older readings.');
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    loadFirstPage();
  }, [device.deviceId]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>

        <Text style={styles.title}>{device.label} Full History</Text>
        <Text style={styles.detailSubheader}>{device.deviceId}</Text>

        {loading ? (
          <ActivityIndicator size="large" />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <>
            <SignalChartCard
              title="Full Deploy History"
              signals={summarySignals}
              helperText={`${totalPoints.toLocaleString()} raw points • chart bucketed to ${summarySignals.length.toLocaleString()} points`}
            />

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent Readings</Text>
              <Text style={styles.helperText}>
                Loaded {historyReadings.length.toLocaleString()} of{' '}
                {totalPoints.toLocaleString()} readings
              </Text>

              {annotatedHistoryReadings.length === 0 ? (
                <Text style={styles.emptyText}>No readings available.</Text>
              ) : (
                annotatedHistoryReadings.map((point, index) => (
                  <View
                    key={`${device.deviceId}-${point.timestamp}-${index}`}
                    style={[
                      styles.readingRow,
                      index !== annotatedHistoryReadings.length - 1 &&
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
                          ? `${formatDuration(
                              point.completedRunDurationSeconds
                            )} (completed run)`
                          : '0:00'}
                    </Text>
                  </View>
                ))
              )}

              {hasMore ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.loadOlderButton,
                    pressed && styles.latestReadingCardPressed,
                  ]}
                  onPress={loadOlder}
                >
                  {loadingOlder ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Text style={styles.loadOlderButtonText}>Load older readings</Text>
                  )}
                </Pressable>
              ) : (
                <Text style={styles.endOfListText}>All readings loaded.</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function HomeScreen() {
  const [devices, setDevices] = useState<DeviceConfig[]>(FALLBACK_DEVICES);
  const [signalMap, setSignalMap] = useState<Record<string, SignalPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const devicesRef = useRef<DeviceConfig[]>(FALLBACK_DEVICES);
  const lastTimestampMapRef = useRef<Record<string, string | null>>({});
  const initializedRef = useRef(false);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
  );

  const fetchDevices = async () => {
    try {
      const response = await fetch(`${API_BASE}/devices`);

      if (!response.ok) {
        throw new Error(`Devices request failed with status ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        return data as DeviceConfig[];
      }
    } catch (err) {
      console.error('Could not load device list, using fallback list.', err);
    }

    return FALLBACK_DEVICES;
  };

  const fetchRecentSignalsForDevices = async (deviceList: DeviceConfig[]) => {
    const responses = await Promise.all(
      deviceList.map(async (device) => {
        const params = new URLSearchParams({
          deviceId: device.deviceId,
          limit: String(DASHBOARD_SIGNAL_LIMIT),
        });

        const response = await fetch(`${API_BASE}/signals?${params.toString()}`);

        if (!response.ok) {
          throw new Error(
            `Signals request failed for ${device.deviceId} with status ${response.status}`
          );
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error(`Backend did not return an array for ${device.deviceId}.`);
        }

        return {
          deviceId: device.deviceId,
          signals: sortSignalsAscending(data as SignalPoint[]),
        };
      })
    );

    const nextSignalMap: Record<string, SignalPoint[]> = {};
    const nextLastTimestampMap: Record<string, string | null> = {};

    responses.forEach(({ deviceId, signals }) => {
      nextSignalMap[deviceId] = signals;
      nextLastTimestampMap[deviceId] =
        signals.length > 0 ? signals[signals.length - 1].timestamp : null;
    });

    return {
      nextSignalMap,
      nextLastTimestampMap,
    };
  };

  const pollDashboardSignals = async () => {
    if (!initializedRef.current) {
      return;
    }

    const deviceList = devicesRef.current;

    if (deviceList.length === 0) {
      return;
    }

    try {
      const responses = await Promise.all(
        deviceList.map(async (device) => {
          const params = new URLSearchParams({
            deviceId: device.deviceId,
          });

          const since = lastTimestampMapRef.current[device.deviceId];

          if (since) {
            params.set('since', since);
          } else {
            params.set('limit', String(DASHBOARD_SIGNAL_LIMIT));
          }

          const response = await fetch(`${API_BASE}/signals?${params.toString()}`);

          if (!response.ok) {
            throw new Error(
              `Signals request failed for ${device.deviceId} with status ${response.status}`
            );
          }

          const data = await response.json();

          if (!Array.isArray(data)) {
            throw new Error(`Backend did not return an array for ${device.deviceId}.`);
          }

          return {
            deviceId: device.deviceId,
            signals: sortSignalsAscending(data as SignalPoint[]),
          };
        })
      );

      setSignalMap((previous) => {
        const nextSignalMap = { ...previous };
        const nextLastTimestampMap = { ...lastTimestampMapRef.current };

        responses.forEach(({ deviceId, signals }) => {
          nextSignalMap[deviceId] = mergeSignals(
            previous[deviceId] ?? [],
            signals
          );

          const latestPoint =
            nextSignalMap[deviceId][nextSignalMap[deviceId].length - 1] ?? null;

          nextLastTimestampMap[deviceId] = latestPoint?.timestamp ?? null;
        });

        lastTimestampMapRef.current = nextLastTimestampMap;
        return nextSignalMap;
      });
    } catch (err) {
      console.error('Dashboard poll failed.', err);
    }
  };

  useEffect(() => {
    let isCancelled = false;

    const initialize = async () => {
      setLoading(true);
      setError('');

      try {
        const deviceList = await fetchDevices();

        if (isCancelled) {
          return;
        }

        setDevices(deviceList);
        devicesRef.current = deviceList;

        const { nextSignalMap, nextLastTimestampMap } =
          await fetchRecentSignalsForDevices(deviceList);

        if (isCancelled) {
          return;
        }

        setSignalMap(nextSignalMap);
        lastTimestampMapRef.current = nextLastTimestampMap;
      } catch (err) {
        console.error(err);

        if (!isCancelled) {
          setError('Could not load signal data from backend.');
        }
      } finally {
        if (!isCancelled) {
          initializedRef.current = true;
          setLoading(false);
        }
      }
    };

    initialize();

    const interval = setInterval(() => {
      pollDashboardSignals();
    }, REFRESH_MS);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (selectedDevice && !loading && !error) {
    return (
      <RecentReadingsScreen
        device={selectedDevice}
        onBack={() => setSelectedDeviceId(null)}
      />
    );
  }

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
              onOpenRecentReadings={(selected) =>
                setSelectedDeviceId(selected.deviceId)
              }
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
  detailSubheader: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: -12,
    marginBottom: 24,
    textAlign: 'center',
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
  helperText: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: -4,
    marginBottom: 10,
  },
  latestReadingCard: {
    borderWidth: 1,
    borderColor: '#dbe4f0',
  },
  latestReadingCardPressed: {
    opacity: 0.85,
  },
  latestReadingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  openDetailsText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
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
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  loadOlderButton: {
    alignSelf: 'center',
    marginTop: 16,
    backgroundColor: '#eff6ff',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  loadOlderButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  endOfListText: {
    marginTop: 16,
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 14,
  },
});