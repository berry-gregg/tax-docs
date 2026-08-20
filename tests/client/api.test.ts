import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { ApiError, getJson, sendJson, startPolling, uploadFile } from "../../src/client/app/api.ts";

const originalFetch = globalThis.fetch;

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return Promise.resolve(handler(call));
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const countSchema = z.object({ count: z.number().int() });

describe("getJson", () => {
  test("parses the response through the caller's schema", async () => {
    stubFetch(() => jsonResponse({ count: 4 }));

    expect(await getJson("/api/inbox/unread-count", countSchema)).toEqual({ count: 4 });
  });

  test("throws ApiError carrying the server's error string verbatim", async () => {
    stubFetch(() => jsonResponse({ error: "Document is not awaiting review" }, 409));

    const error = await getJson("/api/documents/doc-1", countSchema).catch((cause) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe("Document is not awaiting review");
  });

  test("falls back to the status line when the body carries no error string", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 502, statusText: "Bad Gateway" }));

    const error = await getJson("/api/metrics", countSchema).catch((cause) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toContain("502");
  });

  test("a response that does not match the schema fails loudly with the path", async () => {
    stubFetch(() => jsonResponse({ count: "four" }));

    const error = await getJson("/api/metrics", countSchema).catch((cause) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain("/api/metrics");
  });
});

describe("sendJson", () => {
  test("sends the method, JSON content type, and body", async () => {
    const calls = stubFetch(() => jsonResponse({ count: 1 }));

    await sendJson("POST", "/api/clients", { legalName: "Northwind" }, countSchema);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/clients");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("Content-Type")).toBe("application/json");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ legalName: "Northwind" }));
  });

  test("a 204 with no body parses as null", async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    expect(await sendJson("POST", "/api/inbox/act-1/read", null, z.null())).toBeNull();
  });

  test("surfaces the server validation message verbatim", async () => {
    stubFetch(() => jsonResponse({ error: "ein is required" }, 400));

    const error = await sendJson("POST", "/api/clients", {}, countSchema).catch((cause) => cause);

    expect((error as ApiError).message).toBe("ein is required");
    expect((error as ApiError).status).toBe(400);
  });
});

describe("uploadFile", () => {
  test("posts multipart form data with the file and the extra fields", async () => {
    const calls = stubFetch(() => jsonResponse({ count: 1 }, 201));
    const file = new File([new Uint8Array([1, 2, 3])], "w2.pdf", { type: "application/pdf" });

    await uploadFile("/api/documents", file, { engagementId: "eng-1" }, countSchema);

    const body = calls[0]?.init?.body;
    expect(calls[0]?.init?.method).toBe("POST");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("engagementId")).toBe("eng-1");
    expect(((body as FormData).get("file") as File).name).toBe("w2.pdf");
  });
});

describe("startPolling", () => {
  test("runs on an interval until stop is called", async () => {
    let runs = 0;
    const stop = startPolling(async () => {
      runs += 1;
    }, 5);

    await Bun.sleep(30);
    const afterPolling = runs;
    stop();
    await Bun.sleep(20);

    expect(afterPolling).toBeGreaterThanOrEqual(2);
    expect(runs).toBe(afterPolling);
  });

  test("a rejected tick does not stop the loop", async () => {
    let runs = 0;
    const stop = startPolling(async () => {
      runs += 1;
      throw new Error("transient");
    }, 5);

    await Bun.sleep(30);
    stop();

    expect(runs).toBeGreaterThanOrEqual(2);
  });
});
