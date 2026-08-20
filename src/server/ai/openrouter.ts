import { Buffer } from "node:buffer";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { config } from "../config.ts";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const APP_TITLE = "tax-docs";
const MAX_ATTEMPTS = 2;
const ERROR_BODY_LIMIT = 500;

// OpenRouter parses PDFs through the file-parser plugin. "native" forwards the file to models
// that accept file input natively (the configured default google/gemini-3.7-flash does);
// a text-only model needs "mistral-ocr" (scans, paid) or "cloudflare-ai" (free) instead.
const PDF_PLUGIN = { id: "file-parser", pdf: { engine: "native" } } as const;

/**
 * Injectable fetch seam. Bun's `typeof fetch` carries a `preconnect` property, so the call
 * signature is spelled out here to keep test stubs cast-free; the global `fetch` satisfies it.
 */
export type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export type TextPart = { type: "text"; text: string };
export type FilePart = { type: "file"; file: { filename: string; file_data: string } };
export type UserPart = TextPart | FilePart;

export type StructuredRequest<T> = {
  /** Trusted instructions only. Untrusted content belongs in `parts`, fenced via `fences.ts`. */
  system: string;
  parts: UserPart[];
  schemaName: string;
  schema: z.ZodType<T>;
};

export type OpenRouterConfig = {
  openrouterApiKey: string | undefined;
  openrouterModel: string;
};

export type OpenRouterClient = {
  completeStructured<T>(req: StructuredRequest<T>): Promise<T>;
};

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const errorEnvelopeSchema = z.object({ error: z.object({ message: z.string() }) });

export function pdfFilePart(filename: string, bytes: Uint8Array): FilePart {
  const base64 = Buffer.from(bytes).toString("base64");
  return {
    type: "file",
    file: { filename, file_data: `data:application/pdf;base64,${base64}` },
  };
}

function toStrictJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = {
    ...zodToJsonSchema(schema, { target: "openAi", $refStrategy: "none" }),
  };
  delete jsonSchema.$schema;
  return jsonSchema;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeErrorBody(rawBody: string): string {
  try {
    const envelope = errorEnvelopeSchema.safeParse(JSON.parse(rawBody));
    if (envelope.success) return envelope.data.error.message;
  } catch {
    // Non-JSON error bodies fall through to the truncated raw body below.
  }
  return rawBody.slice(0, ERROR_BODY_LIMIT);
}

type ContentResult<T> = { ok: true; data: T } | { ok: false; error: unknown; message: string };

function parseContent<T>(schema: z.ZodType<T>, content: string): ContentResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    return { ok: false, error, message: messageOf(error) };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: parsed.error, message: parsed.error.message };
}

async function requestCompletionContent(args: {
  fetchImpl: FetchLike;
  apiKey: string;
  model: string;
  system: string;
  parts: UserPart[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}): Promise<string> {
  const response = await args.fetchImpl(COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Title": APP_TITLE,
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.parts },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: args.schemaName, strict: true, schema: args.jsonSchema },
      },
      plugins: [PDF_PLUGIN],
    }),
  });

  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenRouter request for "${args.schemaName}" failed with status ${response.status}: ${describeErrorBody(rawBody)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (error) {
    throw new Error(
      `OpenRouter returned a non-JSON body for "${args.schemaName}": ${messageOf(error)}`,
      { cause: error },
    );
  }

  const completion = completionSchema.safeParse(json);
  if (!completion.success) {
    throw new Error(
      `OpenRouter returned an unexpected completion envelope for "${args.schemaName}": ${completion.error.message}`,
      { cause: completion.error },
    );
  }

  return completion.data.choices[0]!.message.content;
}

export function createOpenRouterClient(opts?: {
  fetchImpl?: FetchLike;
  config?: OpenRouterConfig;
}): OpenRouterClient {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const clientConfig: OpenRouterConfig = opts?.config ?? config;

  return {
    async completeStructured<T>(req: StructuredRequest<T>): Promise<T> {
      const apiKey = clientConfig.openrouterApiKey;
      if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

      const jsonSchema = toStrictJsonSchema(req.schema);
      let parts = req.parts;
      let lastError: unknown;
      let lastMessage = "";

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const content = await requestCompletionContent({
          fetchImpl,
          apiKey,
          model: clientConfig.openrouterModel,
          system: req.system,
          parts,
          schemaName: req.schemaName,
          jsonSchema,
        });

        const result = parseContent(req.schema, content);
        if (result.ok) return result.data;

        lastError = result.error;
        lastMessage = result.message;
        parts = [
          ...parts,
          {
            type: "text",
            text: `Your previous response failed validation: ${lastMessage}. Return only valid JSON for the schema.`,
          },
        ];
      }

      throw new Error(
        `OpenRouter response for "${req.schemaName}" failed schema validation after ${MAX_ATTEMPTS} attempts: ${lastMessage}`,
        { cause: lastError },
      );
    },
  };
}
