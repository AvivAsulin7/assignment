import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, getJson } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { TemperatureChart } from '../components/TemperatureChart';
import type { FridgeDetail as FridgeDetailData, ImportAnalysis } from '../types';

type Import = FridgeDetailData['imports'][number];
type Reading = FridgeDetailData['readings'][number];

/** Stored local logger time 'YYYY-MM-DD HH:MM:SS', shown without seconds. */
const time = (at: string) => at.slice(0, 16);

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function FridgeDetail() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<FridgeDetailData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    getJson<FridgeDetailData>(`/api/fridges/${encodeURIComponent(id)}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: ApiError) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <section>
      <Link to="/" className="back">
        ← All fridges
      </Link>

      {error && (error.status === 404 || error.status === 400) && (
        <div className="card">
          <h1>Fridge not found</h1>
          <p>This fridge doesn't exist. It may have been entered with a different link.</p>
        </div>
      )}
      {error && error.status !== 404 && error.status !== 400 && (
        <p className="error" role="alert">
          Could not load this fridge: {error.message}
        </p>
      )}
      {!error && !detail && <p className="muted">Loading fridge…</p>}

      {detail && <Detail detail={detail} />}
    </section>
  );
}

function Detail({ detail }: { detail: FridgeDetailData }) {
  const { fridge, status, statusImportId, imports, readings } = detail;
  const statusImport = imports.find((i) => i.id === statusImportId);
  const unitByImport = new Map(imports.map((i) => [i.id, i.unit]));

  return (
    <>
      <div className="detail-header">
        <div>
          <p className="muted branch-name">{fridge.branch}</p>
          <h1>{fridge.name}</h1>
        </div>
        <StatusBadge status={status} />
      </div>

      {statusImport?.analysis ? (
        <p className="muted">
          Current status is based on the latest uploaded data: <strong>{statusImport.filename}</strong> (
          {time(statusImport.analysis.firstAt)} – {time(statusImport.analysis.lastAt)}).
        </p>
      ) : (
        <p className="muted">No readings are stored for this fridge yet.</p>
      )}

      {readings.length > 0 && (
        <div className="card">
          <h2>Temperature history</h2>
          <TemperatureChart detail={detail} />
          <p className="muted small">
            Dashed red line: 5 °C limit. Shaded: time above 5 °C. The line is broken where a reading is invalid,
            where data is missing, and between uploaded files.
          </p>
        </div>
      )}

      {imports.length > 0 && (
        <>
          <h2>Uploaded files and what we found</h2>
          {[...imports].reverse().map((imp) => (
            <ImportCard key={imp.id} imp={imp} isStatusImport={imp.id === statusImportId} />
          ))}
        </>
      )}

      {readings.length > 0 && (
        <details className="card">
          <summary>All readings ({readings.length})</summary>
          <ul className="reading-list">
            {readings.map((r) => (
              <ReadingRow key={r.id} r={r} unit={unitByImport.get(r.importId)} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ImportCard({ imp, isStatusImport }: { imp: Import; isStatusImport: boolean }) {
  const a = imp.analysis;
  return (
    <div className="card">
      <h3>{imp.filename}</h3>
      <p className="muted small">
        Logger {imp.loggerId} · {imp.unit === 'F' ? 'converted from °F' : 'recorded in °C'} · uploaded{' '}
        {new Date(imp.importedAt).toLocaleString()}
        {a && (
          <>
            <br />
            Readings {time(a.firstAt)} – {time(a.lastAt)}
          </>
        )}
      </p>
      {isStatusImport && <p className="tag">Current status is based on this file</p>}
      {a ? <Findings a={a} /> : <p>This file added no new readings (its rows were already saved or could not be read).</p>}
    </div>
  );
}

function Findings({ a }: { a: ImportAnalysis }) {
  if (!a.excursions.length && !a.warming.length && !a.gaps.length && !a.spikes.length) {
    return <p className="ok-text">No problems found in this file.</p>;
  }
  return (
    <ul className="findings">
      {a.excursions.map((e) => (
        <li key={`e-${e.startAt}`} className="finding status-excursion">
          <strong>Above 5 °C</strong>{' '}
          {e.endAt === null
            ? e.minutes > 0
              ? `from ${time(e.startAt)}, still above 5 °C at the end of this file (at least ${duration(e.minutes)}).`
              : `at ${time(e.startAt)}, the last reading in this file — how long it lasted is not known yet.`
            : `from ${time(e.startAt)} to ${time(e.endAt)} (${duration(e.minutes)}).`}{' '}
          Highest: {e.peakC} °C.
          {e.containsMissingData && (
            <span className="note"> Some readings are missing during this period, so the exact duration is uncertain.</span>
          )}
        </li>
      ))}
      {a.warming.map((w) => (
        <li key={`w-${w.startAt}`} className="finding status-warming">
          <strong>Warming</strong> from {w.fromC} °C to {w.toC} °C (+{w.riseC} °C), {time(w.startAt)} – {time(w.endAt)}.
        </li>
      ))}
      {a.gaps.map((g) => (
        <li key={`g-${g.startAt}`} className="finding status-gaps">
          <strong>No data</strong> from {time(g.startAt)} to {time(g.endAt)} ({duration(g.minutes)}).
        </li>
      ))}
      {a.spikes.map((s) => (
        <li key={`s-${s.readingId}`} className="finding status-none">
          <strong>Single high reading</strong> of {s.temperatureC} °C at {time(s.at)}, with normal readings either
          side (for example a door opening). Not treated as a temperature problem.
        </li>
      ))}
    </ul>
  );
}

function ReadingRow({ r, unit }: { r: Reading; unit: 'C' | 'F' | undefined }) {
  return (
    <li>
      <span className="muted">{time(r.recordedAt)}</span>
      {r.temperatureC === null ? (
        <span className="invalid">Invalid: {r.rawTemperature.trim() || 'empty'}</span>
      ) : (
        <span>
          {r.temperatureC} °C{unit === 'F' && <span className="muted"> ({r.rawTemperature.trim()} °F)</span>}
        </span>
      )}
    </li>
  );
}
