import { z } from "zod";

/**
 * The single fetch seam between the client shell and the Hono API. Every response parses through
 * a shared schema from `src/shared/schemas/api.ts`, and every failure keeps the server's own
 * message so pages can show the real cause instead of "something went wrong".
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const errorBodySchema = z.object({ error: z.string().min(1) });

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text.length > 0) {
    try {
      const parsed = errorBodySchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        return parsed.data.error;
      }
    } catch {
      // Not JSON — fall through to the status line rather than echoing an HTML error page.
    }
  }

  return `${response.status} ${response.statusText || "Request failed"}`.trim();
}

async function parseResponse<T>(response: Response, path: string, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new ApiError(response.status, `Unexpected response from ${path}: ${issues}`);
  }

  return parsed.data;
}

export async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  return parseResponse(response, path, schema);
}

export async function sendJson<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse(response, path, schema);
}

export async function uploadFile<T>(
  path: string,
  file: File,
  extra: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(extra)) {
    form.append(key, value);
  }
  form.append("file", file);

  const response = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  return parseResponse(response, path, schema);
}

/**
 * Polling is how the pipeline becomes visible without websockets. A failing tick is logged and
 * the loop continues — a transient API blip must not freeze the page.
 */
export function startPolling(fn: () => Promise<void>, ms: number): () => void {
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) {
      return;
    }

    void fn().catch((error: unknown) => {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`Polling tick failed: ${cause}`);
    });
  }, ms);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
