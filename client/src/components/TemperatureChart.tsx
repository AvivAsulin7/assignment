import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FridgeDetail } from '../types';

/** The documented 5 °C limit, drawn for orientation only — no rule is evaluated here. */
const LIMIT_C = 5;

// recordedAt is local logger time without a zone. Encoding it as UTC and formatting
// back in UTC shows exactly the stored time, with no browser time-zone shift.
const toMs = (at: string) => Date.parse(`${at.replace(' ', 'T')}Z`);
const formatTime = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const formatTick = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');

type Point = { x: number; t: number | null };

/**
 * Temperature over time, built only from the server's readings and findings.
 * The line breaks (null point) at invalid readings, at gaps reported by the
 * server, and between imports — it never draws a line across unknown time.
 */
export function TemperatureChart({ detail }: { detail: FridgeDetail }) {
  const { readings, imports } = detail;
  const gapPairs = new Set(
    imports.flatMap((i) => i.analysis?.gaps ?? []).map((g) => `${g.readingIds[0]}-${g.readingIds[1]}`),
  );
  const timeById = new Map(readings.map((r) => [r.id, toMs(r.recordedAt)]));

  const points: Point[] = [];
  readings.forEach((r, i) => {
    const prev = readings[i - 1];
    if (prev && (prev.importId !== r.importId || gapPairs.has(`${prev.id}-${r.id}`))) {
      points.push({ x: (toMs(prev.recordedAt) + toMs(r.recordedAt)) / 2, t: null });
    }
    points.push({ x: toMs(r.recordedAt), t: r.temperatureC });
  });

  // Shade each excursion from its start to its end (or its last reading while ongoing).
  const excursionAreas = imports
    .flatMap((i) => i.analysis?.excursions ?? [])
    .map((e) => ({
      x1: toMs(e.startAt),
      x2: e.endAt ? toMs(e.endAt) : timeById.get(e.readingIds[e.readingIds.length - 1])!,
    }));

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#e4e7eb" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTick}
            tick={{ fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis unit="°" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
          {excursionAreas.map((a, i) => (
            <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill="#fde8e8" fillOpacity={0.8} ifOverflow="extendDomain" />
          ))}
          <ReferenceLine
            y={LIMIT_C}
            stroke="#d64545"
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
            label={{ value: '5 °C', position: 'insideTopRight', fontSize: 11, fill: '#9b1c1c' }}
          />
          <Tooltip
            labelFormatter={(x) => formatTime(Number(x))}
            formatter={(v) => [`${v} °C`, 'Temperature']}
          />
          <Line
            type="linear"
            dataKey="t"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
