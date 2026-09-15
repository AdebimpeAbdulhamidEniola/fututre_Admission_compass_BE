import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/client.js";

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console -- startup banner, not app logging
  console.log(`PlaceRight backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
