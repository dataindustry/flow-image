import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeConfig } from "./lib/config.mjs";
import { SessionStore } from "./lib/store.mjs";
import { pairsRouter } from "./routes/pairs.mjs";
import { sessionsRouter } from "./routes/sessions.mjs";
import { screenshotsRouter } from "./routes/screenshots.mjs";
import { annotationsRouter } from "./routes/annotations.mjs";
import { filesRouter } from "./routes/files.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webPublicDir = path.resolve(__dirname, "../../web/public");

export function createApp(overrides = {}) {
  const config = makeConfig(overrides);
  const store = new SessionStore(config);
  const app = express();

  app.locals.config = config;
  app.locals.store = store;
  app.use(express.json());
  app.use("/api/pairs", pairsRouter({ store }));
  app.use("/api/sessions", sessionsRouter({ config, store }));
  app.use("/api/sessions", screenshotsRouter({ store }));
  app.use("/api/sessions", annotationsRouter({ store }));
  app.use("/files", filesRouter({ store }));
  app.use(express.static(webPublicDir));
  app.get("/s/:sessionId", (req, res) => {
    res.sendFile(path.join(webPublicDir, "index.html"));
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = makeConfig();
  const app = createApp(config);
  app.listen(config.port, config.bindHost, () => {
    console.log(`FlowImage backend listening on http://${config.bindHost}:${config.port}`);
  });
}
