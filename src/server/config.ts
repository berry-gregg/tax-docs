const DEFAULT_PORT = 3000;
const DEFAULT_MONGODB_DB = "tax_docs";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const config = {
  nodeEnv: readEnv("NODE_ENV") ?? "development",
  port: Number(readEnv("PORT") ?? DEFAULT_PORT),
  mongodbUri: readEnv("MONGODB_URI"),
  mongodbDbName: readEnv("MONGODB_DB") ?? DEFAULT_MONGODB_DB,
  isDev: (readEnv("NODE_ENV") ?? "development") === "development",
  openrouterApiKey: readEnv("OPENROUTER_API_KEY"),
  openrouterModel: readEnv("OPENROUTER_MODEL") ?? "google/gemini-3.7-flash",
  uploadsDir: readEnv("UPLOADS_DIR") ?? "data/uploads",
} as const;
