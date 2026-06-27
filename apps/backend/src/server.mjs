import express from "express";
import { makeConfig } from "./lib/config.mjs";
import { SessionStore } from "./lib/store.mjs";
import { sessionsRouter } from "./routes/sessions.mjs";

export function createApp(overrides = {}) {
  const config = makeConfig(overrides);
  const store = new SessionStore(config);
  const app = express();

  app.locals.config = config;
  app.locals.store = store;
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter({ config, store }));

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = makeConfig();
  const app = createApp(config);
  app.listen(config.port, config.bindHost, () => {
    console.log(`ui-loop backend listening on http://${config.bindHost}:${config.port}`);
  });
}
