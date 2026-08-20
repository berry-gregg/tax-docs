import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createOpenRouterClient,
  pdfFilePart,
  type FetchLike,
  type OpenRouterConfig,
} from "../../src/server/ai/openrouter.ts";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = "test-key-not-a-real-secret";

const testConfig: OpenRouterConfig = {
  openrouterApiKey: API_KEY,
  openrouterModel: "google/gemini-3.7-flash",
};

const extractionSchema = z.object({ formType: z.string(), wages: z.number() });

const contentPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  file: z.object({ filename: z.string(), file_data: z.string() }).optional(),
});

const requestBodySchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.union([z.string(), z.array(contentPartSchema)]),
    }),
  ),
  response_format: z.object({
    type: z.string(),
    json_schema: z.object({
      name: z.string(),
      strict: z.boolean(),
      schema: z.record(z.unknown()),
    }),
  }),
  plugins: z.array(z.object({ id: z.string(), pdf: z.object({ engine: z.string() }) })),
});

const jsonSchemaShapeSchema = z.object({
  type: z.literal("object"),
  additionalProperties: z.literal(false),
  required: z.array(z.string()),
  properties: z.record(z.unknown()),
});

type RecordedCall = {
  url: string;
  authorization: string | null;
  contentType: string | null;
  body: z.infer<typeof requestBodySchema>;
};

function stubFetch(responses: Response[]): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      authorization: headers.get("Authorization"),
      contentType: headers.get("Content-Type"),
      body: requestBodySchema.parse(JSON.parse(String(init?.body))),
    });
    const response = responses[index];
    index += 1;
    if (!response) throw new Error(`unexpected fetch call #${index}`);
    return response;
  };
  return { fetchImpl, calls };
}

function completionResponse(content: string): Response {
  return Response.json({ choices: [{ message: { role: "assistant", content } }] });
}

function userParts(call: RecordedCall): z.infer<typeof contentPartSchema>[] {
  const userMessage = call.body.messages.find((message) => message.role === "user");
  const content = userMessage?.content;
  if (!content || typeof content === "string") {
    throw new Error("expected the user message to carry an array of parts");
  }
  return content;
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  const result = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  if (!(result instanceof Error)) throw new Error("expected the call to reject with an Error");
  return result;
}

describe("createOpenRouterClient.completeStructured", () => {
  test("posts the chat-completions request shape the OpenRouter docs specify", async () => {
    const { fetchImpl, calls } = stubFetch([
      completionResponse(JSON.stringify({ formType: "W-2", wages: 42000 })),
    ]);
    const client = createOpenRouterClient({ fetchImpl, config: testConfig });

    await client.completeStructured({
      system: "You extract tax fields.",
      parts: [{ type: "text", text: "UNTRUSTED DATA. …" }],
      schemaName: "w2_extraction",
      schema: extractionSchema,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(COMPLETIONS_URL);
    expect(call.authorization).toBe(`Bearer ${API_KEY}`);
    expect(call.contentType).toBe("application/json");
    expect(call.body.model).toBe("google/gemini-3.7-flash");
    expect(call.body.messages[0]).toEqual({
      role: "system",
      content: "You extract tax fields.",
    });
    expect(userParts(call)).toEqual([{ type: "text", text: "UNTRUSTED DATA. …" }]);
    expect(call.body.response_format.type).toBe("json_schema");
    expect(call.body.response_format.json_schema.name).toBe("w2_extraction");
    expect(call.body.response_format.json_schema.strict).toBe(true);
    expect(call.body.plugins[0]?.id).toBe("file-parser");
  });

  test("sends a strict json schema derived from the zod schema", async () => {
    const { fetchImpl, calls } = stubFetch([
      completionResponse(JSON.stringify({ formType: "W-2", wages: 42000 })),
    ]);
    const client = createOpenRouterClient({ fetchImpl, config: testConfig });

    await client.completeStructured({
      system: "You extract tax fields.",
      parts: [{ type: "text", text: "…" }],
      schemaName: "w2_extraction",
      schema: extractionSchema,
    });

    const jsonSchema = jsonSchemaShapeSchema.parse(
      calls[0]!.body.response_format.json_schema.schema,
    );
    expect(jsonSchema.required).toEqual(["formType", "wages"]);
    expect(Object.keys(jsonSchema.properties)).toEqual(["formType", "wages"]);
  });

  test("returns schema-parsed data from a valid completion", async () => {
    const { fetchImpl } = stubFetch([
      completionResponse(JSON.stringify({ formType: "W-2", wages: 42000 })),
    ]);
    const client = createOpenRouterClient({ fetchImpl, config: testConfig });

    const result = await client.completeStructured({
      system: "You extract tax fields.",
      parts: [{ type: "text", text: "…" }],
      schemaName: "w2_extraction",
      schema: extractionSchema,
    });

    expect(result).toEqual({ formType: "W-2", wages: 42000 });
  });

  test("retries once with the validation failure appended, then succeeds", async () => {
    const { fetchImpl, calls } = stubFetch([
      completionResponse(JSON.stringify({ formType: "W-2", wages: "forty two thousand" })),
      completionResponse(JSON.stringify({ formType: "W-2", wages: 42000 })),
    ]);
    const client = createOpenRouterClient({ fetchImpl, config: testConfig });

    const result = await client.completeStructured({
      system: "You extract tax fields.",
      parts: [{ type: "text", text: "first attempt part" }],
      schemaName: "w2_extraction",
      schema: extractionSchema,
    });

    expect(result).toEqual({ formType: "W-2", wages: 42000 });
    expect(calls).toHaveLength(2);

    const retryParts = userParts(calls[1]!);
    expect(retryParts[0]).toEqual({ type: "text", text: "first attempt part" });
    const retryNote = retryParts[retryParts.length - 1]?.text ?? "";
    expect(retryNote).toContain("Your previous response failed validation:");
    expect(retryNote).toContain("Return only valid JSON for the schema.");
    expect(retryNote).toContain("wages");
  });

  test("retries once when the completion is not valid JSON", async () => {
    const { fetchImpl, calls } = stubFetch([
      completionResponse("Here you go: {formType: W-2"),
      completionResponse(JSON.stringify({ formType: "W-2", wages: 42000 })),
    ]);
    const client = createOpenRouterClient({ fetchImpl, config: testConfig });

    const result = await client.completeStructured({
      system: "You extract tax fields.",
      parts: [{ type: "text", text: "…" }],
      schemaName: "w2_extraction",
      schema: extractionSchema,
    });

    expect(result).toEqual({ formType: "W-2", wages: 42000 });
    expect(calls).toHaveLength(2);
  });

  test("throws with the underlying validation cause after two failures", async () => {
    const { fetchImpl, calls } = stubFetch([
      completionResponse(JSON.stringify({ formType: "W-2", wages: "nope" })),
      completionResponse(JSON.stringify({ formType: "W-2", wages: "still nope" })),
    ]);
    const client = createOpenRouterClient({ fetchImpl, config: testConfig });

    const error = await rejection(
      client.completeStructured({
        system: "You extract tax fields.",
        parts: [{ type: "text", text: "…" }],
        schemaName: "w2_extraction",
        schema: extractionSchema,
      }),
    );

    expect(calls).toHaveLength(2);
    expect(error.message).toContain("w2_extraction");
    expect(error.message).toContain("wages");
    expect(error.message).not.toContain(API_KEY);
    expect(error.cause).toBeInstanceOf(z.ZodError);
  });

  test("throws with the HTTP status on a non-200 and never leaks the key", async () => {
    const { fetchImpl, calls } = stubFetch([
      Response.json({ error: { code: 502, message: "Provider returned an error" } }, { status: 502 }),
    ]);
    const client = createOpenRouterClient({ fetchImpl, config: testConfig });

    const error = await rejection(
      client.completeStructured({
        system: "You extract tax fields.",
        parts: [{ type: "text", text: "…" }],
        schemaName: "w2_extraction",
        schema: extractionSchema,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(error.message).toContain("502");
    expect(error.message).toContain("Provider returned an error");
    expect(error.message).not.toContain(API_KEY);
  });

  test("throws when the api key is missing, without calling fetch", async () => {
    const { fetchImpl, calls } = stubFetch([]);
    const client = createOpenRouterClient({
      fetchImpl,
      config: { openrouterApiKey: undefined, openrouterModel: "google/gemini-3.7-flash" },
    });

    const error = await rejection(
      client.completeStructured({
        system: "You extract tax fields.",
        parts: [{ type: "text", text: "…" }],
        schemaName: "w2_extraction",
        schema: extractionSchema,
      }),
    );

    expect(error.message).toBe("OPENROUTER_API_KEY is not configured");
    expect(calls).toHaveLength(0);
  });
});

describe("pdfFilePart", () => {
  test("encodes bytes as a base64 application/pdf data url", () => {
    const part = pdfFilePart("W-2.pdf", new Uint8Array([37, 80, 68, 70]));

    expect(part.type).toBe("file");
    expect(part.file.filename).toBe("W-2.pdf");
    expect(part.file.file_data.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(part.file.file_data).toBe(`data:application/pdf;base64,${btoa("%PDF")}`);
  });
});
