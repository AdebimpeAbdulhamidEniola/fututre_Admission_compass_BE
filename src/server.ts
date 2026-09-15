import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console -- startup banner, not app logging
  console.log(`PlaceRight backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
