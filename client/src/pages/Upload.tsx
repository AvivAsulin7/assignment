import { useState, type ChangeEvent, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { postJson } from '../api';
import type { ColumnMapping, ImportSummary, SkippedRow, Unit, UploadPreview } from '../types';

type Columns = { timestamp: number | null; temperature: number | null };

const columnLabel = (headers: string[], index: number | null) =>
  index === null ? '—' : headers[index] || `Column ${index + 1}`;

export function Upload() {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [columns, setColumns] = useState<Columns>({ timestamp: null, temperature: null });
  const [loggerId, setLoggerId] = useState('');
  const [branch, setBranch] = useState('');
  const [fridge, setFridge] = useState('');
  const [unit, setUnit] = useState<Unit>('C');
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);

  async function runPreview(name: string, content: string, mapping?: ColumnMapping) {
    setBusy('preview');
    setError(null);
    try {
      const p = await postJson<UploadPreview>('/api/uploads/preview', { filename: name, content, columns: mapping });
      setPreview(p);
      setColumns(p.columns ?? { timestamp: p.detection.timestamp, temperature: p.detection.temperature });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    setPreview(null);
    setResult(null);
    setError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const content = await selected.text();
    setFile({ name: selected.name, content });
    await runPreview(selected.name, content);
  }

  function onColumnChange(role: keyof Columns, value: string) {
    const next = { ...columns, [role]: value === '' ? null : Number(value) };
    setColumns(next);
    // Until the server previews the new choice, there is nothing to import.
    setPreview((p) => p && { ...p, columns: null, counts: null, firstAt: null, lastAt: null, sampleRows: [] });
    if (file && next.timestamp !== null && next.temperature !== null) {
      void runPreview(file.name, file.content, { timestamp: next.timestamp, temperature: next.temperature });
    }
  }

  async function onImport(e: SubmitEvent) {
    e.preventDefault();
    if (!file || !preview?.columns || busy) return;
    setBusy('import');
    setError(null);
    try {
      const summary = await postJson<ImportSummary>('/api/imports', {
        filename: file.name,
        content: file.content,
        columns: preview.columns,
        loggerId,
        branch,
        fridge,
        unit,
      });
      setResult(summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setColumns({ timestamp: null, temperature: null });
    setLoggerId('');
    setBranch('');
    setFridge('');
    setUnit('C');
    setError(null);
    setResult(null);
  }

  if (result) {
    return (
      <section>
        <h1>Import complete</h1>
        <ImportResult result={result} filename={file?.name ?? ''} />
        <button type="button" onClick={reset}>
          Upload another file
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1>Upload logger file</h1>

      <div className="card">
        <label htmlFor="file">CSV file from the logger</label>
        <input id="file" type="file" accept=".csv,text/csv" onChange={onFileChange} disabled={busy !== null} />
        {busy === 'preview' && <p className="muted">Reading file…</p>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {file && preview && (
        <>
          <div className="card">
            <h2>{file.name}</h2>
            {preview.headers.length === 0 ? (
              <p>The file is empty.</p>
            ) : (
              <>
                {preview.detection.confident ? (
                  <dl className="facts">
                    <dt>Time column</dt>
                    <dd>{columnLabel(preview.headers, columns.timestamp)}</dd>
                    <dt>Temperature column</dt>
                    <dd>{columnLabel(preview.headers, columns.temperature)}</dd>
                  </dl>
                ) : (
                  <>
                    <p>We couldn't tell which columns hold the time and temperature. Please choose them.</p>
                    <div className="warning">
                      <p>
                        The first row of the file is being used as column names:{' '}
                        <strong>{preview.headers.map((h) => `“${h}”`).join(', ')}</strong>.
                      </p>
                      <p>
                        Files without a header row are not supported: if that row is actually a reading, it will not be
                        imported. Add a header row (for example <code>Time,Temp</code>) and upload the file again.
                      </p>
                    </div>
                    <ColumnSelect id="col-timestamp" label="Time column" headers={preview.headers} value={columns.timestamp}
                      onChange={(v) => onColumnChange('timestamp', v)} disabled={busy !== null} />
                    <ColumnSelect id="col-temperature" label="Temperature column" headers={preview.headers} value={columns.temperature}
                      onChange={(v) => onColumnChange('temperature', v)} disabled={busy !== null} />
                  </>
                )}

                <dl className="facts">
                  <dt>Rows</dt>
                  <dd>{preview.rowCount}</dd>
                  {preview.firstAt && (
                    <>
                      <dt>From</dt>
                      <dd>{preview.firstAt}</dd>
                      <dt>To</dt>
                      <dd>{preview.lastAt}</dd>
                    </>
                  )}
                </dl>

                {preview.counts && (
                  <ul className="counts">
                    <li><strong>{preview.counts.valid}</strong> valid</li>
                    <li><strong>{preview.counts.invalid}</strong> invalid (e.g. ERR)</li>
                    <li><strong>{preview.counts.rejected}</strong> unreadable time</li>
                    <li><strong>{preview.counts.duplicates}</strong> duplicates</li>
                    <li><strong>{preview.counts.conflicts}</strong> conflicts</li>
                  </ul>
                )}

                {preview.issues.length > 0 && (
                  <div className="warning">
                    <p>Some lines in the file look malformed:</p>
                    <ul>
                      {preview.issues.map((i, n) => (
                        <li key={n}>{i.line ? `Line ${i.line}: ` : ''}{i.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.sampleRows.length > 0 && (
                  <table className="sample">
                    <caption>First rows, as written in the file</caption>
                    <thead>
                      <tr><th>Line</th><th>Time</th><th>Temp</th></tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((r) => (
                        <tr key={r.line}>
                          <td>{r.line}</td>
                          <td>{r.rawTimestamp}</td>
                          <td>{r.rawTemperature}{r.invalidReason && <span className="muted"> (invalid)</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>

          {preview.columns && (
            <form className="card" onSubmit={onImport}>
              <h2>Which fridge is this?</h2>
              <label htmlFor="loggerId">Logger ID</label>
              <input id="loggerId" value={loggerId} onChange={(e) => setLoggerId(e.target.value)}
                placeholder="e.g. TL-0417" required />
              <label htmlFor="branch">Branch</label>
              <input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)}
                placeholder="e.g. Tel Aviv" required />
              <label htmlFor="fridge">Fridge</label>
              <input id="fridge" value={fridge} onChange={(e) => setFridge(e.target.value)}
                placeholder="e.g. Walk-in" required />

              <fieldset>
                <legend>Temperatures in the file are in</legend>
                <label className="choice">
                  <input type="radio" name="unit" checked={unit === 'C'} onChange={() => setUnit('C')} />
                  Celsius (°C)
                </label>
                <label className="choice">
                  <input type="radio" name="unit" checked={unit === 'F'} onChange={() => setUnit('F')} />
                  Fahrenheit (°F)
                </label>
              </fieldset>

              <button type="submit" disabled={busy !== null}>
                {busy === 'import' ? 'Importing…' : 'Import readings'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function ColumnSelect(props: {
  id: string;
  label: string;
  headers: string[];
  value: number | null;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { id } = props;
  return (
    <>
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value)} disabled={props.disabled}>
        <option value="">Choose…</option>
        {props.headers.map((_, i) => (
          <option key={i} value={i}>
            {columnLabel(props.headers, i)}
          </option>
        ))}
      </select>
    </>
  );
}

function ImportResult({ result, filename }: { result: ImportSummary; filename: string }) {
  const c = result.counts;
  return (
    <div className="card">
      <h2>{filename}</h2>
      <ul className="counts">
        <li><strong>{c.rows}</strong> rows in file</li>
        <li><strong>{c.inserted}</strong> saved</li>
        <li><strong>{c.invalid}</strong> saved as invalid (e.g. ERR)</li>
        <li><strong>{c.rejected}</strong> skipped: unreadable time</li>
        <li><strong>{c.duplicates}</strong> skipped: already saved</li>
        <li><strong>{c.conflicts}</strong> skipped: conflicting value</li>
      </ul>
      <SkippedList title="Rows with an unreadable time" rows={result.rejected} />
      <SkippedList title="Rows that conflict with an existing reading" rows={result.conflicts} />
      <p>
        <Link to="/">Back to all fridges</Link>
      </p>
    </div>
  );
}

function SkippedList({ title, rows }: { title: string; rows: SkippedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="warning">
      <p>{title}:</p>
      <ul>
        {rows.map((r) => (
          <li key={r.line}>
            Line {r.line}: “{r.rawTimestamp}”, “{r.rawTemperature}” — {r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
