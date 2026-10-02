/**
 * POSTs JSON and returns the parsed response. Throws an Error whose message
 * can be shown to the user (the API's `error` text when there is one).
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}
