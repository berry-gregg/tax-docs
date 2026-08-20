import { connectDb, disconnectDb } from "../src/server/db/client.ts";
import { resetAndSeed, seedIfEmpty } from "../src/server/seed/seed.ts";

const db = await connectDb();
try {
  if (process.argv.includes("--reset")) {
    await resetAndSeed(db);
    console.log("reset and seeded demo book");
  } else if (await seedIfEmpty(db)) {
    console.log("seeded demo book");
  } else {
    console.log("demo book already seeded");
  }
} finally {
  await disconnectDb();
}
