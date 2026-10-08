import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/client.js";
import { getModel } from "./modules/recommender/model.js";

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console -- startup banner, not app logging
  console.log(`PlaceRight backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
  // Load (or train) the recommender now so the first assessment doesn't wait for it. A failure
  // here is retried on the first request that needs the model.
  getModel().catch((err: unknown) => {
    // eslint-disable-next-line no-console -- startup warning, not app logging
    console.warn("Recommender model not ready yet:", err instanceof Error ? err.message : err);
  });
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
