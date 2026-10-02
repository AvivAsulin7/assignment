import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getJson } from '../api';
import { StatusBadge, statusKey } from '../components/StatusBadge';
import type { FridgeOverview } from '../types';

// Display order only, so problems are seen first; the status itself comes from the server.
const ATTENTION_ORDER = { excursion: 0, warming: 1, gaps: 2, none: 3, ok: 4 };
const attention = (f: FridgeOverview) => ATTENTION_ORDER[statusKey(f.status)];

/** Groups fridges by branch; branches and fridges needing attention come first. */
function groupByBranch(fridges: FridgeOverview[]): [string, FridgeOverview[]][] {
  const groups = new Map<string, FridgeOverview[]>();
  for (const f of fridges) groups.set(f.branch, [...(groups.get(f.branch) ?? []), f]);
  const byAttention = (a: FridgeOverview, b: FridgeOverview) => attention(a) - attention(b) || a.name.localeCompare(b.name);
  return [...groups.entries()]
    .map(([branch, list]) => [branch, [...list].sort(byAttention)] as [string, FridgeOverview[]])
    .sort(([a, la], [b, lb]) => attention(la[0]) - attention(lb[0]) || a.localeCompare(b));
}

export function Overview() {
  const [fridges, setFridges] = useState<FridgeOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<FridgeOverview[]>('/api/fridges')
      .then((data) => !cancelled && setFridges(data))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h1>Fridges</h1>

      {error && (
        <p className="error" role="alert">
          Could not load fridges: {error}
        </p>
      )}

      {!error && fridges === null && <p className="muted">Loading fridges…</p>}

      {fridges?.length === 0 && (
        <div className="card">
          <p>No fridges yet. Upload a logger file to get started.</p>
          <Link to="/upload">Upload a logger file</Link>
        </div>
      )}

      {fridges &&
        groupByBranch(fridges).map(([branch, list]) => (
          <div key={branch} className="branch">
            <h2>{branch}</h2>
            <ul className="fridge-list">
              {list.map((f) => (
                <li key={f.id}>
                  <Link to={`/fridges/${f.id}`} className={`fridge-card status-${statusKey(f.status)}`}>
                    <span className="fridge-name">{f.name}</span>
                    <StatusBadge status={f.status} />
                    <LatestReading reading={f.latestReading} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function LatestReading({ reading }: { reading: FridgeOverview['latestReading'] }) {
  if (!reading) return <span className="latest muted">No readings</span>;
  // recordedAt is local logger time 'YYYY-MM-DD HH:MM:SS'; shown as-is, without time-zone conversion.
  const time = reading.recordedAt.slice(0, 16);
  return (
    <span className="latest">
      {reading.temperatureC === null ? (
        <span className="muted">Latest reading invalid</span>
      ) : (
        <strong>{reading.temperatureC} °C</strong>
      )}{' '}
      <span className="muted">at {time}</span>
    </span>
  );
}
