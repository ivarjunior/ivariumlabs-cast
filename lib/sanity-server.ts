import "server-only";

const projectId =
  process.env.SANITY_PROJECT_ID ||
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||
  "snnkgi7q";
const dataset =
  process.env.SANITY_DATASET ||
  process.env.NEXT_PUBLIC_SANITY_DATASET ||
  "production";
const apiVersion =
  process.env.SANITY_API_VERSION ||
  process.env.NEXT_PUBLIC_SANITY_API_VERSION ||
  "2025-01-01";

const readApiUrl = `https://${projectId}.api.sanity.io/v${apiVersion}/data/query/${dataset}`;
const mutateApiUrl = `https://${projectId}.api.sanity.io/v${apiVersion}/data/mutate/${dataset}`;
const SANITY_FETCH_TIMEOUT_MS = 15_000;
const SANITY_FETCH_RETRIES = 2;

export function isSanityServerConfigured() {
  return Boolean(
    projectId.trim() &&
      dataset.trim() &&
      (process.env.SANITY_API_TOKEN || "").trim(),
  );
}

function getAuthHeaders() {
  const token = (process.env.SANITY_API_TOKEN || "").trim();

  if (!token) {
    throw new Error(
      "Missing SANITY_API_TOKEN environment variable for server-side Sanity access.",
    );
  }

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sanityFetchWithRetry(
  url: string,
  init: RequestInit,
  action: "query" | "mutation",
) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= SANITY_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SANITY_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      return response;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Unknown fetch error");

      if (attempt < SANITY_FETCH_RETRIES) {
        await wait((attempt + 1) * 250);
        continue;
      }

      throw new Error(`Sanity ${action} network error: ${lastError.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(
    `Sanity ${action} network error: ${lastError?.message || "Unknown fetch error"}`,
  );
}

export async function sanityQueryServer<T>(query: string): Promise<T> {
  const url = `${readApiUrl}?${new URLSearchParams({ query }).toString()}`;
  const response = await sanityFetchWithRetry(
    url,
    {
      headers: getAuthHeaders(),
      cache: "no-store",
    },
    "query",
  );

  if (!response.ok) {
    let detail = "";

    try {
      const body = (await response.json()) as {
        error?: { description?: string; message?: string };
      };
      detail = body.error?.description || body.error?.message || "";
    } catch {
      detail = "";
    }

    throw new Error(
      detail
        ? `Sanity query failed (${response.status}): ${detail}`
        : `Sanity query failed with status ${response.status}`,
    );
  }

  const json = (await response.json()) as { result: T };

  return json.result;
}

export async function sanityMutateServer<T>(
  mutations: Array<Record<string, unknown>>,
): Promise<T> {
  const response = await sanityFetchWithRetry(
    mutateApiUrl,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ mutations }),
      cache: "no-store",
    },
    "mutation",
  );

  if (!response.ok) {
    let detail = "";

    try {
      const body = (await response.json()) as {
        error?: { description?: string; message?: string };
      };
      detail = body.error?.description || body.error?.message || "";
    } catch {
      detail = "";
    }

    throw new Error(
      detail
        ? `Sanity mutation failed (${response.status}): ${detail}`
        : `Sanity mutation failed with status ${response.status}`,
    );
  }

  return (await response.json()) as T;
}
