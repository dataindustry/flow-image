import express from "express";
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeConfig } from "./lib/config.mjs";
import { SessionStore } from "./lib/store.mjs";
import { sessionsRouter } from "./routes/sessions.mjs";
import { screenshotsRouter } from "./routes/screenshots.mjs";
import { annotationsRouter } from "./routes/annotations.mjs";
import { filesRouter } from "./routes/files.mjs";
import { shareRouter } from "./routes/share.mjs";
import { qrRouter } from "./routes/qr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webPublicDir = path.resolve(__dirname, "../../web/public");

export function createApp(overrides = {}) {
  const config = makeConfig(overrides);
  const store = new SessionStore(config);
  const app = express();
  store.cleanupExpiredSessions().catch((error) => {
    console.error("FlowImage cleanup failed", error);
  });

  app.locals.config = config;
  app.locals.store = store;
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'"
    );
    next();
  });
  app.use(express.json());
  app.use("/api/qr", qrRouter({ config, store }));
  app.use("/api/share", shareRouter({ store }));
  app.use("/api/sessions", sessionsRouter({ config, store }));
  app.use("/api/sessions", screenshotsRouter({ config, store }));
  app.use("/api/sessions", annotationsRouter({ config, store }));
  app.use("/files", filesRouter({ store }));
  app.use(
    express.static(webPublicDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
          res.setHeader("Cache-Control", "no-store");
        }
      }
    })
  );
  app.get(["/v/:token", "/e/:token", "/o/:token"], (req, res) => {
    res.sendFile(path.join(webPublicDir, "index.html"));
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const config = app.locals.config;
  const server = createServer(app, config);
  const scheme = config.https ? "https" : "http";
  server.listen(config.port, config.bindHost, () => {
    console.log(`FlowImage backend listening on ${scheme}://${config.bindHost}:${config.port}`);
    console.log(`FlowImage public URL ${config.publicBaseUrl}`);
  });
}

function createServer(app, config) {
  if (!config.https) return http.createServer(app);
  return https.createServer(
    {
      cert: readFileSync(config.https.certPath),
      key: readFileSync(config.https.keyPath)
    },
    app
  );
}
