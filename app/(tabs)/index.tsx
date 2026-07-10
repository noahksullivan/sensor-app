import React, { useEffect, useMemo, useState } from 'react';
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
const HISTORY_BUCKET_COUNT = 800;
const HISTORY_PAGE_SIZE = 200;
const DASHBOARD_TRANSITION_LIMIT = 20;

const PRESSURE_DASHBOARD_LIMIT = 600;
const PRESSURE_RECENT_LIMIT = 200;
const PRESSURE_HISTORY_BUCKET_COUNT = 800;

const PRESSURE_CHART_POINT_SPACING = 18;
const PRESSURE_CHART_LABEL_EVERY = 30;

type SignalPoint = {
  deviceId: string;
  triggered: boolean;
  value: number;
  timestamp: string;
};

type DeviceType = 'current' | 'pressure';
type DeviceUnit = 'A' | 'kPa';

type DeviceConfig = {
  deviceId: string;
  label: string;
  type: DeviceType;
  unit: DeviceUnit;
};

type PressurePoint = {
  deviceId: string;
  value: number;
  unit: 'kPa';
  timestamp: string;
  sampleCount: number;
  sensorOutputVolts: number | null;
  adcMillivolts: number | null;
  windowStartedAt: string | null;
};

type PressureDashboardData = {
  readings: PressurePoint[];
  latestReading: PressurePoint | null;
};

type PressureSummaryResponse = {
  deviceId: string;
  totalPoints: number;
  bucketCount: number;
  oldestTimestamp: string | null;
  latestTimestamp: string | null;
  points: PressurePoint[];
};

type TransitionEntry = {
  state: 'ON' | 'OFF';
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
};

type DashboardDeviceData = {
  deviceId: string;
  thresholdAmps: number;
  latestSignal: SignalPoint | null;
  currentState: 'ON' | 'OFF' | null;
  currentStateStartedAt: string | null;
  currentStateDurationSeconds: number;
  lastCompletedOnDurationSeconds: number | null;
  lastCompletedOffDurationSeconds: number | null;
  recentTransitions: TransitionEntry[];
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
  {
    deviceId: 'esp32-001',
    label: 'Hilltop',
    type: 'current',
    unit: 'A',
  },
  {
    deviceId: 'esp32-002',
    label: 'Site 3',
    type: 'current',
    unit: 'A',
  },
  {
    deviceId: 'esp32-003',
    label: 'Pressure Sensor',
    type: 'pressure',
    unit: 'kPa',
  },
];

const createEmptyDashboardData = (
  deviceId: string
): DashboardDeviceData => ({
  deviceId,
  thresholdAmps: ON_THRESHOLD_AMPS,
  latestSignal: null,
  currentState: null,
  currentStateStartedAt: null,
  currentStateDurationSeconds: 0,
  lastCompletedOnDurationSeconds: null,
  lastCompletedOffDurationSeconds: null,
  recentTransitions: [],
});

const createEmptyPressureDashboardData =
  (): PressureDashboardData => ({
    readings: [],
    latestReading: null,
  });

const formatDuration = (totalSeconds: number) => {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatOptionalDuration = (
  totalSeconds: number | null
) => {
  if (totalSeconds === null) {
    return 'N/A';
  }

  return formatDuration(totalSeconds);
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
      runStartMs !== null
        ? lastOnDurationSeconds
        : null;

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

  const previousDate = previousTimestamp
    ? new Date(previousTimestamp)
    : null;

  const dayChanged =
    !previousDate ||
    date.getFullYear() !==
      previousDate.getFullYear() ||
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

const buildChartLabels = (
  signals: SignalPoint[]
) => {
  if (signals.length === 0) {
    return [''];
  }

  return signals.map((point, index) => {
    const previousTimestamp =
      index > 0
        ? signals[index - 1].timestamp
        : null;

    const currentDate = new Date(
      point.timestamp
    );

    const previousDate = previousTimestamp
      ? new Date(previousTimestamp)
      : null;

    const dayChanged =
      !previousDate ||
      currentDate.getFullYear() !==
        previousDate.getFullYear() ||
      currentDate.getMonth() !==
        previousDate.getMonth() ||
      currentDate.getDate() !==
        previousDate.getDate();

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
  });
};

const buildYAxisLabels = (
  values: number[],
  segments: number
) => {
  const maxValue = Math.max(...values, 0.1);

  return Array.from(
    { length: segments + 1 },
    (_, index) => {
      const value =
        (maxValue / segments) *
        (segments - index);

      return value.toFixed(2);
    }
  );
};

const sortSignalsAscending = (
  points: SignalPoint[]
) =>
  points
    .slice()
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime()
    );

const sortPressureAscending = (
  points: PressurePoint[]
) =>
  points
    .slice()
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime()
    );

const didLocalDayChange = (
  currentTimestamp: string,
  previousTimestamp?: string | null
) => {
  if (!previousTimestamp) {
    return true;
  }

  const current = new Date(currentTimestamp);
  const previous = new Date(previousTimestamp);

  return (
    current.getFullYear() !==
      previous.getFullYear() ||
    current.getMonth() !== previous.getMonth() ||
    current.getDate() !== previous.getDate()
  );
};

const buildPressureChartLabels = (
  readings: PressurePoint[]
) => {
  if (readings.length === 0) {
    return [''];
  }

  return readings.map((reading, index) => {
    const previousTimestamp =
      index > 0
        ? readings[index - 1].timestamp
        : null;

    const dayChanged = didLocalDayChange(
      reading.timestamp,
      previousTimestamp
    );

    const date = new Date(reading.timestamp);

    /*
      A vertical bar plus the date marks the first
      pressure point of each new local calendar day.
    */
    if (dayChanged) {
      return `│ ${date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
      })}`;
    }

    const shouldShowTime =
      index === readings.length - 1 ||
      index % PRESSURE_CHART_LABEL_EVERY === 0;

    if (!shouldShowTime) {
      return '';
    }

    return date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  });
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

  const chartLabels =
    buildChartLabels(signals);

  const chartValues =
    signals.length > 0
      ? signals.map((point) => point.value)
      : [0];

  const yAxisLabels = buildYAxisLabels(
    chartValues,
    CHART_SEGMENTS
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {title}
      </Text>

      {helperText ? (
        <Text style={styles.helperText}>
          {helperText}
        </Text>
      ) : null}

      <View style={styles.chartRow}>
        <View style={styles.yAxisColumn}>
          {yAxisLabels.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              style={styles.yAxisLabelText}
            >
              {label}
            </Text>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={
            styles.chartScrollContent
          }
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

              color: (opacity = 1) =>
                `rgba(37, 99, 235, ${opacity})`,

              labelColor: (opacity = 1) =>
                `rgba(17, 24, 39, ${opacity})`,

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

function PressureChartCard({
  title,
  readings,
  helperText,
}: {
  title: string;
  readings: PressurePoint[];
  helperText?: string;
}) {
  if (readings.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {title}
        </Text>

        {helperText ? (
          <Text style={styles.helperText}>
            {helperText}
          </Text>
        ) : null}

        <Text style={styles.emptyText}>
          No pressure readings available yet.
        </Text>
      </View>
    );
  }

  const sortedReadings =
    sortPressureAscending(readings);

  const chartLabels =
    buildPressureChartLabels(sortedReadings);

  const chartValues = sortedReadings.map(
    (reading) => reading.value
  );

  const dynamicChartWidth = Math.max(
    CHART_WIDTH,
    sortedReadings.length *
      PRESSURE_CHART_POINT_SPACING
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {title}
      </Text>

      {helperText ? (
        <Text style={styles.helperText}>
          {helperText}
        </Text>
      ) : null}

      <Text style={styles.axisTitle}>
        Y-axis: Maximum Pressure (kPa)
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={
          styles.chartScrollContent
        }
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
          height={CHART_HEIGHT + 30}
          segments={CHART_SEGMENTS}
          fromZero={false}
          withDots={
            sortedReadings.length <= 150
          }
          withHorizontalLabels
          withVerticalLabels
          yAxisLabel=""
          yAxisSuffix=" kPa"
          verticalLabelRotation={30}
          formatYLabel={(value) =>
            Number(value).toFixed(2)
          }
          chartConfig={{
            backgroundColor: '#ffffff',
            backgroundGradientFrom: '#ffffff',
            backgroundGradientTo: '#ffffff',
            decimalPlaces: 2,

            color: (opacity = 1) =>
              `rgba(37, 99, 235, ${opacity})`,

            labelColor: (opacity = 1) =>
              `rgba(17, 24, 39, ${opacity})`,

            propsForDots: {
              r: '3',
              strokeWidth: '1',
              stroke: '#2563eb',
            },

            propsForBackgroundLines: {
              stroke: '#e5e7eb',
              strokeDasharray: '',
            },
          }}
          style={styles.chart}
        />
      </ScrollView>

      <Text style={styles.xAxisTitle}>
        X-axis: Time • │ date marks the first
        reading of a new day
      </Text>
    </View>
  );
}

function PumpStatusCard({
  dashboardData,
}: {
  dashboardData: DashboardDeviceData;
}) {
  if (
    !dashboardData.latestSignal ||
    !dashboardData.currentState
  ) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Pump Status
        </Text>

        <Text style={styles.emptyText}>
          No readings available yet.
        </Text>
      </View>
    );
  }

  const isCurrentlyOn =
    dashboardData.currentState === 'ON';

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        Pump Status
      </Text>

      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusBadge,
            isCurrentlyOn
              ? styles.statusBadgeOn
              : styles.statusBadgeOff,
          ]}
        >
          <Text style={styles.statusBadgeText}>
            {isCurrentlyOn ? 'ON' : 'OFF'}
          </Text>
        </View>

        <Text style={styles.statusText}>
          Threshold:{' '}
          {dashboardData.thresholdAmps.toFixed(1)} A
        </Text>
      </View>

      <Text style={styles.statusDetail}>
        {isCurrentlyOn
          ? `Pump has been ON for ${formatDuration(
              dashboardData.currentStateDurationSeconds
            )}`
          : `Pump has been OFF for ${formatDuration(
              dashboardData.currentStateDurationSeconds
            )}`}
      </Text>
    </View>
  );
}

function StateLogCard({
  dashboardData,
}: {
  dashboardData: DashboardDeviceData;
}) {
  const currentState =
    dashboardData.currentState;

  const currentStartedAt =
    dashboardData.currentStateStartedAt;

  const onDurationLabel =
    currentState === 'ON'
      ? 'Current ON Time'
      : 'Last ON Time';

  const onDurationValue =
    currentState === 'ON'
      ? formatDuration(
          dashboardData.currentStateDurationSeconds
        )
      : formatOptionalDuration(
          dashboardData.lastCompletedOnDurationSeconds
        );

  const offDurationLabel =
    currentState === 'OFF'
      ? 'Current OFF Time'
      : 'Last OFF Time';

  const offDurationValue =
    currentState === 'OFF'
      ? formatDuration(
          dashboardData.currentStateDurationSeconds
        )
      : formatOptionalDuration(
          dashboardData.lastCompletedOffDurationSeconds
        );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        State Change Log
      </Text>

      <Text style={styles.helperText}>
        Logs threshold crossings at{' '}
        {dashboardData.thresholdAmps.toFixed(1)} A
      </Text>

      <View style={styles.stateSummaryGrid}>
        <View style={styles.stateSummaryItem}>
          <Text style={styles.stateSummaryLabel}>
            Current State
          </Text>

          <Text style={styles.stateSummaryValue}>
            {currentState ?? 'N/A'}
          </Text>
        </View>

        <View style={styles.stateSummaryItem}>
          <Text style={styles.stateSummaryLabel}>
            Current State Since
          </Text>

          <Text
            style={
              styles.stateSummaryValueSmall
            }
          >
            {currentStartedAt
              ? formatTimestamp(currentStartedAt)
              : 'N/A'}
          </Text>
        </View>

        <View style={styles.stateSummaryItem}>
          <Text style={styles.stateSummaryLabel}>
            {onDurationLabel}
          </Text>

          <Text style={styles.stateSummaryValue}>
            {onDurationValue}
          </Text>
        </View>

        <View style={styles.stateSummaryItem}>
          <Text style={styles.stateSummaryLabel}>
            {offDurationLabel}
          </Text>

          <Text style={styles.stateSummaryValue}>
            {offDurationValue}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>
        Recent State Changes
      </Text>

      {dashboardData.recentTransitions.length ===
      0 ? (
        <Text style={styles.emptyText}>
          No completed state changes yet.
        </Text>
      ) : (
        dashboardData.recentTransitions.map(
          (entry, index) => (
            <View
              key={`${entry.state}-${entry.startedAt}-${entry.endedAt}-${index}`}
              style={[
                styles.transitionRow,

                index !==
                  dashboardData.recentTransitions
                    .length -
                    1 &&
                  styles.transitionRowBorder,
              ]}
            >
              <View
                style={[
                  styles.transitionBadge,

                  entry.state === 'ON'
                    ? styles.transitionBadgeOn
                    : styles.transitionBadgeOff,
                ]}
              >
                <Text
                  style={
                    styles.transitionBadgeText
                  }
                >
                  {entry.state}
                </Text>
              </View>

              <View
                style={
                  styles.transitionContent
                }
              >
                <Text
                  style={
                    styles.transitionTimeText
                  }
                >
                  {formatTimestamp(
                    entry.startedAt
                  )}{' '}
                  →{' '}
                  {formatTimestamp(entry.endedAt)}
                </Text>

                <Text
                  style={
                    styles.transitionDurationText
                  }
                >
                  {entry.state} for{' '}
                  {formatDuration(
                    entry.durationSeconds
                  )}
                </Text>
              </View>
            </View>
          )
        )
      )}
    </View>
  );
}

function DevicePanel({
  device,
  dashboardData,
  onOpenRecentReadings,
}: {
  device: DeviceConfig;
  dashboardData: DashboardDeviceData;
  onOpenRecentReadings: (
    device: DeviceConfig
  ) => void;
}) {
  const latestSignal =
    dashboardData.latestSignal;

  return (
    <View style={styles.deviceSection}>
      <Text style={styles.deviceHeader}>
        {device.label}
      </Text>

      <Text style={styles.deviceSubheader}>
        {device.deviceId}
      </Text>

      <StateLogCard
        dashboardData={dashboardData}
      />

      <PumpStatusCard
        dashboardData={dashboardData}
      />

      <Pressable
        style={({ pressed }) => [
          styles.card,
          styles.latestReadingCard,

          pressed &&
            styles.latestReadingCardPressed,
        ]}
        onPress={() =>
          onOpenRecentReadings(device)
        }
      >
        <View
          style={styles.latestReadingHeaderRow}
        >
          <Text style={styles.cardTitle}>
            Latest Reading
          </Text>

          <Text style={styles.openDetailsText}>
            Open full history →
          </Text>
        </View>

        <Text style={styles.label}>
          Device ID
        </Text>

        <Text style={styles.value}>
          {latestSignal?.deviceId ?? 'N/A'}
        </Text>

        <Text style={styles.label}>
          Status
        </Text>

        <Text style={styles.value}>
          {dashboardData.currentState ?? 'N/A'}
        </Text>

        <Text style={styles.label}>
          Current Value
        </Text>

        <Text style={styles.value}>
          {latestSignal
            ? `${latestSignal.value.toFixed(
                3
              )} A`
            : 'N/A'}
        </Text>

        <Text style={styles.label}>
          Timestamp
        </Text>

        <Text style={styles.value}>
          {latestSignal
            ? formatTimestamp(
                latestSignal.timestamp
              )
            : 'N/A'}
        </Text>
      </Pressable>
    </View>
  );
}

function PressureDevicePanel({
  device,
  pressureData,
  onOpenRecentReadings,
}: {
  device: DeviceConfig;
  pressureData: PressureDashboardData;
  onOpenRecentReadings: (
    device: DeviceConfig
  ) => void;
}) {
  const latestReading =
    pressureData.latestReading;

  return (
    <View style={styles.deviceSection}>
      <Text style={styles.deviceHeader}>
        {device.label}
      </Text>

      <Text style={styles.deviceSubheader}>
        {device.deviceId}
      </Text>

      <PressureChartCard
        title="Pressure History"
        readings={pressureData.readings}
        helperText="Each point is the highest pressure measured during one 10-second, 100-sample window."
      />

      <Pressable
        style={({ pressed }) => [
          styles.card,
          styles.latestReadingCard,

          pressed &&
            styles.latestReadingCardPressed,
        ]}
        onPress={() =>
          onOpenRecentReadings(device)
        }
      >
        <View
          style={styles.latestReadingHeaderRow}
        >
          <Text style={styles.cardTitle}>
            Latest Pressure Window
          </Text>

          <Text style={styles.openDetailsText}>
            Open full history →
          </Text>
        </View>

        <Text style={styles.label}>
          Device ID
        </Text>

        <Text style={styles.value}>
          {latestReading?.deviceId ?? 'N/A'}
        </Text>

        <Text style={styles.label}>
          Maximum Pressure
        </Text>

        <Text style={styles.value}>
          {latestReading
            ? `${latestReading.value.toFixed(
                3
              )} kPa`
            : 'N/A'}
        </Text>

        <Text style={styles.label}>
          Samples in Window
        </Text>

        <Text style={styles.value}>
          {latestReading
            ? latestReading.sampleCount
            : 'N/A'}
        </Text>

        <Text style={styles.label}>
          Window Started
        </Text>

        <Text style={styles.value}>
          {latestReading?.windowStartedAt
            ? formatTimestamp(
                latestReading.windowStartedAt
              )
            : 'N/A'}
        </Text>

        <Text style={styles.label}>
          Window Ended
        </Text>

        <Text style={styles.value}>
          {latestReading
            ? formatTimestamp(
                latestReading.timestamp
              )
            : 'N/A'}
        </Text>

        <Text style={styles.label}>
          Sensor Output
        </Text>

        <Text style={styles.value}>
          {latestReading?.sensorOutputVolts !=
          null
            ? `${latestReading.sensorOutputVolts.toFixed(
                3
              )} V`
            : 'N/A'}
        </Text>
      </Pressable>
    </View>
  );
}

function PressureHistoryScreen({
  device,
  onBack,
}: {
  device: DeviceConfig;
  onBack: () => void;
}) {
  const [
    summaryReadings,
    setSummaryReadings,
  ] = useState<PressurePoint[]>([]);

  const [
    recentReadings,
    setRecentReadings,
  ] = useState<PressurePoint[]>([]);

  const [totalPoints, setTotalPoints] =
    useState(0);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const newestReadingsFirst = useMemo(
    () =>
      recentReadings
        .slice()
        .reverse(),
    [recentReadings]
  );

  const loadPressureHistory = async () => {
    setLoading(true);
    setError('');

    try {
      const summaryParams =
        new URLSearchParams({
          deviceId: device.deviceId,

          bucketCount: String(
            PRESSURE_HISTORY_BUCKET_COUNT
          ),
        });

      const recentParams =
        new URLSearchParams({
          deviceId: device.deviceId,

          limit: String(
            PRESSURE_RECENT_LIMIT
          ),
        });

      const [
        summaryResponse,
        recentResponse,
      ] = await Promise.all([
        fetch(
          `${API_BASE}/pressure/summary?${summaryParams.toString()}`
        ),

        fetch(
          `${API_BASE}/pressure?${recentParams.toString()}`
        ),
      ]);

      if (!summaryResponse.ok) {
        throw new Error(
          `Pressure summary request failed with status ${summaryResponse.status}`
        );
      }

      if (!recentResponse.ok) {
        throw new Error(
          `Pressure history request failed with status ${recentResponse.status}`
        );
      }

      const summaryData =
        (await summaryResponse.json()) as
          PressureSummaryResponse;

      const recentData =
        (await recentResponse.json()) as
          PressurePoint[];

      setSummaryReadings(
        sortPressureAscending(
          summaryData.points ?? []
        )
      );

      setRecentReadings(
        sortPressureAscending(
          recentData ?? []
        )
      );

      setTotalPoints(
        summaryData.totalPoints ?? 0
      );
    } catch (err) {
      console.error(err);

      setError(
        'Could not load pressure history.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPressureHistory();
  }, [device.deviceId]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
      >
        <Pressable
          style={styles.backButton}
          onPress={onBack}
        >
          <Text style={styles.backButtonText}>
            ← Back
          </Text>
        </Pressable>

        <Text style={styles.title}>
          {device.label} Full History
        </Text>

        <Text style={styles.detailSubheader}>
          {device.deviceId}
        </Text>

        {loading ? (
          <ActivityIndicator size="large" />
        ) : error ? (
          <Text style={styles.error}>
            {error}
          </Text>
        ) : (
          <>
            <PressureChartCard
              title="Full Pressure History"
              readings={summaryReadings}
              helperText={`${totalPoints.toLocaleString()} stored 10-second windows • graph reduced to ${summaryReadings.length.toLocaleString()} peak-preserving points`}
            />

            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Recent Pressure Windows
              </Text>

              <Text style={styles.helperText}>
                Showing the most recent{' '}
                {recentReadings.length.toLocaleString()}{' '}
                of{' '}
                {totalPoints.toLocaleString()}{' '}
                stored windows
              </Text>

              {newestReadingsFirst.length ===
              0 ? (
                <Text style={styles.emptyText}>
                  No pressure readings available.
                </Text>
              ) : (
                newestReadingsFirst.map(
                  (reading, index) => (
                    <View
                      key={`${reading.deviceId}-${reading.timestamp}-${index}`}
                      style={[
                        styles.readingRow,

                        index !==
                          newestReadingsFirst.length -
                            1 &&
                          styles.readingRowBorder,
                      ]}
                    >
                      <Text
                        style={
                          styles.readingTimestamp
                        }
                      >
                        {formatTimestamp(
                          reading.timestamp
                        )}
                      </Text>

                      <Text
                        style={
                          styles.readingText
                        }
                      >
                        Maximum pressure:{' '}
                        {reading.value.toFixed(
                          3
                        )}{' '}
                        kPa
                      </Text>

                      <Text
                        style={
                          styles.readingText
                        }
                      >
                        Samples:{' '}
                        {reading.sampleCount}
                      </Text>

                      <Text
                        style={
                          styles.readingText
                        }
                      >
                        Sensor output:{' '}
                        {reading.sensorOutputVolts ===
                        null
                          ? 'N/A'
                          : `${reading.sensorOutputVolts.toFixed(
                              3
                            )} V`}
                      </Text>

                      <Text
                        style={
                          styles.readingText
                        }
                      >
                        Window started:{' '}
                        {reading.windowStartedAt
                          ? formatTimestamp(
                              reading.windowStartedAt
                            )
                          : 'N/A'}
                      </Text>
                    </View>
                  )
                )
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RecentReadingsScreen({
  device,
  onBack,
}: {
  device: DeviceConfig;
  onBack: () => void;
}) {
  const [
    summarySignals,
    setSummarySignals,
  ] = useState<SignalPoint[]>([]);

  const [
    historyReadings,
    setHistoryReadings,
  ] = useState<SignalPoint[]>([]);

  const [totalPoints, setTotalPoints] =
    useState(0);

  const [nextBefore, setNextBefore] =
    useState<string | null>(null);

  const [hasMore, setHasMore] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [loadingOlder, setLoadingOlder] =
    useState(false);

  const [error, setError] =
    useState('');

  const annotatedHistoryReadings =
    useMemo(() => {
      const chronologicalReadings =
        historyReadings.slice().reverse();

      return annotateSignals(
        chronologicalReadings,
        ON_THRESHOLD_AMPS
      ).reverse();
    }, [historyReadings]);

  const loadFirstPage = async () => {
    setLoading(true);
    setError('');

    try {
      const summaryParams =
        new URLSearchParams({
          deviceId: device.deviceId,

          bucketCount: String(
            HISTORY_BUCKET_COUNT
          ),
        });

      const pageParams =
        new URLSearchParams({
          deviceId: device.deviceId,

          pageSize: String(
            HISTORY_PAGE_SIZE
          ),
        });

      const [
        summaryResponse,
        pageResponse,
      ] = await Promise.all([
        fetch(
          `${API_BASE}/signals/summary?${summaryParams.toString()}`
        ),

        fetch(
          `${API_BASE}/signals/page?${pageParams.toString()}`
        ),
      ]);

      if (!summaryResponse.ok) {
        throw new Error(
          `Summary request failed with status ${summaryResponse.status}`
        );
      }

      if (!pageResponse.ok) {
        throw new Error(
          `Page request failed with status ${pageResponse.status}`
        );
      }

      const summaryData =
        (await summaryResponse.json()) as
          SignalSummaryResponse;

      const pageData =
        (await pageResponse.json()) as
          SignalPageResponse;

      setSummarySignals(
        sortSignalsAscending(
          summaryData.points ?? []
        )
      );

      setHistoryReadings(
        pageData.readings ?? []
      );

      setTotalPoints(
        summaryData.totalPoints ?? 0
      );

      setNextBefore(
        pageData.nextBefore ?? null
      );

      setHasMore(
        Boolean(pageData.hasMore)
      );
    } catch (err) {
      console.error(err);

      setError(
        'Could not load full history for this device.'
      );
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
      const params =
        new URLSearchParams({
          deviceId: device.deviceId,

          pageSize: String(
            HISTORY_PAGE_SIZE
          ),

          before: nextBefore,
        });

      const response = await fetch(
        `${API_BASE}/signals/page?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(
          `Page request failed with status ${response.status}`
        );
      }

      const pageData =
        (await response.json()) as
          SignalPageResponse;

      setHistoryReadings((previous) => [
        ...previous,
        ...(pageData.readings ?? []),
      ]);

      setNextBefore(
        pageData.nextBefore ?? null
      );

      setHasMore(
        Boolean(pageData.hasMore)
      );
    } catch (err) {
      console.error(err);

      setError(
        'Could not load older readings.'
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    loadFirstPage();
  }, [device.deviceId]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
      >
        <Pressable
          style={styles.backButton}
          onPress={onBack}
        >
          <Text style={styles.backButtonText}>
            ← Back
          </Text>
        </Pressable>

        <Text style={styles.title}>
          {device.label} Full History
        </Text>

        <Text style={styles.detailSubheader}>
          {device.deviceId}
        </Text>

        {loading ? (
          <ActivityIndicator size="large" />
        ) : error ? (
          <Text style={styles.error}>
            {error}
          </Text>
        ) : (
          <>
            <SignalChartCard
              title="Full Deploy History"
              signals={summarySignals}
              helperText={`${totalPoints.toLocaleString()} raw points • chart bucketed to ${summarySignals.length.toLocaleString()} points`}
            />

            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Recent Readings
              </Text>

              <Text style={styles.helperText}>
                Loaded{' '}
                {historyReadings.length.toLocaleString()}{' '}
                of{' '}
                {totalPoints.toLocaleString()}{' '}
                readings
              </Text>

              {annotatedHistoryReadings.length ===
              0 ? (
                <Text style={styles.emptyText}>
                  No readings available.
                </Text>
              ) : (
                annotatedHistoryReadings.map(
                  (point, index) => (
                    <View
                      key={`${device.deviceId}-${point.timestamp}-${index}`}
                      style={[
                        styles.readingRow,

                        index !==
                          annotatedHistoryReadings.length -
                            1 &&
                          styles.readingRowBorder,
                      ]}
                    >
                      <Text
                        style={
                          styles.readingTimestamp
                        }
                      >
                        {formatTimestamp(
                          point.timestamp
                        )}
                      </Text>

                      <Text
                        style={
                          styles.readingText
                        }
                      >
                        Current:{' '}
                        {point.value.toFixed(3)} A
                      </Text>

                      <Text
                        style={
                          styles.readingText
                        }
                      >
                        Status:{' '}
                        {point.isOn ? 'ON' : 'OFF'}
                      </Text>

                      <Text
                        style={
                          styles.readingText
                        }
                      >
                        On Time:{' '}
                        {point.isOn
                          ? formatDuration(
                              point.onTimeSeconds
                            )
                          : point.completedRunDurationSeconds !==
                              null
                            ? `${formatDuration(
                                point.completedRunDurationSeconds
                              )} (completed run)`
                            : '0:00'}
                      </Text>
                    </View>
                  )
                )
              )}

              {hasMore ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.loadOlderButton,

                    pressed &&
                      styles.latestReadingCardPressed,
                  ]}
                  onPress={loadOlder}
                >
                  {loadingOlder ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Text
                      style={
                        styles.loadOlderButtonText
                      }
                    >
                      Load older readings
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Text
                  style={styles.endOfListText}
                >
                  All readings loaded.
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function HomeScreen() {
  const [devices, setDevices] =
    useState<DeviceConfig[]>(
      FALLBACK_DEVICES
    );

  const [dashboardMap, setDashboardMap] =
    useState<
      Record<string, DashboardDeviceData>
    >({});

  const [pressureMap, setPressureMap] =
    useState<
      Record<
        string,
        PressureDashboardData
      >
    >({});

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [
    selectedDeviceId,
    setSelectedDeviceId,
  ] = useState<string | null>(null);

  const selectedDevice = useMemo(
    () =>
      devices.find(
        (device) =>
          device.deviceId === selectedDeviceId
      ) ?? null,
    [devices, selectedDeviceId]
  );

  const fetchDevices = async () => {
    try {
      const response = await fetch(
        `${API_BASE}/devices`
      );

      if (!response.ok) {
        throw new Error(
          `Devices request failed with status ${response.status}`
        );
      }

      const data = await response.json();

      if (
        Array.isArray(data) &&
        data.length > 0
      ) {
        return data.map(
          (device: any): DeviceConfig => ({
            deviceId: String(
              device.deviceId
            ),

            label: String(
              device.label ??
                device.deviceId
            ),

            type:
              device.type === 'pressure'
                ? 'pressure'
                : 'current',

            unit:
              device.unit === 'kPa'
                ? 'kPa'
                : 'A',
          })
        );
      }
    } catch (err) {
      console.error(
        'Could not load device list, using fallback list.',
        err
      );
    }

    return FALLBACK_DEVICES;
  };

  const fetchDashboardDataForDevices =
    async (
      deviceList: DeviceConfig[]
    ) => {
      const currentDevices =
        deviceList.filter(
          (device) =>
            device.type === 'current'
        );

      const responses =
        await Promise.all(
          currentDevices.map(
            async (device) => {
              const params =
                new URLSearchParams({
                  deviceId:
                    device.deviceId,

                  transitionLimit: String(
                    DASHBOARD_TRANSITION_LIMIT
                  ),
                });

              const response = await fetch(
                `${API_BASE}/dashboard?${params.toString()}`
              );

              if (!response.ok) {
                throw new Error(
                  `Dashboard request failed for ${device.deviceId} with status ${response.status}`
                );
              }

              const data =
                (await response.json()) as
                  DashboardDeviceData;

              return {
                deviceId:
                  device.deviceId,

                dashboardData: data,
              };
            }
          )
        );

      const nextDashboardMap: Record<
        string,
        DashboardDeviceData
      > = {};

      responses.forEach(
        ({
          deviceId,
          dashboardData,
        }) => {
          nextDashboardMap[deviceId] =
            dashboardData;
        }
      );

      return nextDashboardMap;
    };

  const fetchPressureDataForDevices =
    async (
      deviceList: DeviceConfig[]
    ) => {
      const pressureDevices =
        deviceList.filter(
          (device) =>
            device.type === 'pressure'
        );

      const responses =
        await Promise.all(
          pressureDevices.map(
            async (device) => {
              const params =
                new URLSearchParams({
                  deviceId:
                    device.deviceId,

                  limit: String(
                    PRESSURE_DASHBOARD_LIMIT
                  ),
                });

              const response = await fetch(
                `${API_BASE}/pressure?${params.toString()}`
              );

              if (!response.ok) {
                throw new Error(
                  `Pressure request failed for ${device.deviceId} with status ${response.status}`
                );
              }

              const readings =
                sortPressureAscending(
                  (await response.json()) as
                    PressurePoint[]
                );

              return {
                deviceId:
                  device.deviceId,

                pressureData: {
                  readings,

                  latestReading:
                    readings[
                      readings.length - 1
                    ] ?? null,
                } satisfies PressureDashboardData,
              };
            }
          )
        );

      const nextPressureMap: Record<
        string,
        PressureDashboardData
      > = {};

      responses.forEach(
        ({
          deviceId,
          pressureData,
        }) => {
          nextPressureMap[deviceId] =
            pressureData;
        }
      );

      return nextPressureMap;
    };

  useEffect(() => {
    let isCancelled = false;

    const initialize = async () => {
      setLoading(true);
      setError('');

      try {
        const deviceList =
          await fetchDevices();

        if (isCancelled) {
          return;
        }

        setDevices(deviceList);

        const [
          nextDashboardMap,
          nextPressureMap,
        ] = await Promise.all([
          fetchDashboardDataForDevices(
            deviceList
          ),

          fetchPressureDataForDevices(
            deviceList
          ),
        ]);

        if (isCancelled) {
          return;
        }

        setDashboardMap(
          nextDashboardMap
        );

        setPressureMap(
          nextPressureMap
        );
      } catch (err) {
        console.error(err);

        if (!isCancelled) {
          setError(
            'Could not load dashboard data from backend.'
          );
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    initialize();

    const interval = setInterval(
      async () => {
        try {
          const [
            nextDashboardMap,
            nextPressureMap,
          ] = await Promise.all([
            fetchDashboardDataForDevices(
              devices
            ),

            fetchPressureDataForDevices(
              devices
            ),
          ]);

          if (!isCancelled) {
            setDashboardMap(
              nextDashboardMap
            );

            setPressureMap(
              nextPressureMap
            );
          }
        } catch (err) {
          console.error(
            'Dashboard poll failed.',
            err
          );
        }
      },
      REFRESH_MS
    );

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [devices.length]);

  if (
    selectedDevice &&
    !loading &&
    !error
  ) {
    if (
      selectedDevice.type === 'pressure'
    ) {
      return (
        <PressureHistoryScreen
          device={selectedDevice}
          onBack={() =>
            setSelectedDeviceId(null)
          }
        />
      );
    }

    return (
      <RecentReadingsScreen
        device={selectedDevice}
        onBack={() =>
          setSelectedDeviceId(null)
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={
          styles.scrollContent
        }
      >
        <Text style={styles.title}>
          ESP32 Signal Viewer
        </Text>

        {loading ? (
          <ActivityIndicator size="large" />
        ) : error ? (
          <Text style={styles.error}>
            {error}
          </Text>
        ) : (
          devices.map((device) =>
            device.type === 'pressure' ? (
              <PressureDevicePanel
                key={device.deviceId}
                device={device}
                pressureData={
                  pressureMap[
                    device.deviceId
                  ] ??
                  createEmptyPressureDashboardData()
                }
                onOpenRecentReadings={(
                  selected
                ) =>
                  setSelectedDeviceId(
                    selected.deviceId
                  )
                }
              />
            ) : (
              <DevicePanel
                key={device.deviceId}
                device={device}
                dashboardData={
                  dashboardMap[
                    device.deviceId
                  ] ??
                  createEmptyDashboardData(
                    device.deviceId
                  )
                }
                onOpenRecentReadings={(
                  selected
                ) =>
                  setSelectedDeviceId(
                    selected.deviceId
                  )
                }
              />
            )
          )
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
    shadowOffset: {
      width: 0,
      height: 2,
    },

    elevation: 3,
  },

  helperText: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: -4,
    marginBottom: 10,
  },

  axisTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginTop: 4,
    marginBottom: 4,
  },

  xAxisTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
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

  stateSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },

  stateSummaryItem: {
    width: '48%',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
  },

  stateSummaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '600',
  },

  stateSummaryValue: {
    fontSize: 17,
    color: '#111827',
    fontWeight: '700',
    marginTop: 4,
  },

  stateSummaryValueSmall: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    marginTop: 4,
  },

  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },

  transitionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },

  transitionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },

  transitionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 2,
  },

  transitionBadgeOn: {
    backgroundColor: '#16a34a',
  },

  transitionBadgeOff: {
    backgroundColor: '#dc2626',
  },

  transitionBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },

  transitionContent: {
    flex: 1,
  },

  transitionTimeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },

  transitionDurationText: {
    fontSize: 14,
    color: '#374151',
    marginTop: 4,
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
    shadowOffset: {
      width: 0,
      height: 1,
    },

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