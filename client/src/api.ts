/** Error with a message that can be shown to the user, plus the HTTP status (0 = no response). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Small fetch helpers. Both throw an ApiError whose message can be shown to the
 * user (the API's `error` text when there is one).
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

export function getJson<T>(url: string): Promise<T> {
  return request<T>(url);
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
