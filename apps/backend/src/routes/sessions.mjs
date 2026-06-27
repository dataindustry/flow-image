import express from "express";
import { publicSession } from "../lib/store.mjs";

function getSecret(req) {
  return req.get("X-Session-Secret") ?? req.query.secret;
}

export function requireSessionSecret(store) {
  return async function sessionSecretMiddleware(req, res, next) {
    const session = await store.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "unknown_session" });
      return;
    }
    if (store.isExpired(session)) {
      res.status(410).json({ error: "expired_session" });
      return;
    }
    if (!getSecret(req)) {
      res.status(401).json({ error: "missing_secret" });
      return;
    }
    if (getSecret(req) !== session.session_secret) {
      res.status(403).json({ error: "wrong_secret" });
      return;
    }
    req.session = session;
    next();
  };
}

export function sessionsRouter({ config, store }) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    if (!config.bridgeToken || req.get("X-Bridge-Token") !== config.bridgeToken) {
      res.status(403).json({ error: "wrong_bridge_token" });
      return;
    }

    const title = String(req.body?.title ?? "").trim();
    if (!title || title.length > 120) {
      res.status(400).json({ error: "invalid_title" });
      return;
    }

    const session = await store.createSession({ title });
    res.json({
      session_id: session.session_id,
      session_secret: session.session_secret,
      viewer_url: session.viewer_url,
      expires_at: session.expires_at
    });
  });

  router.get("/:sessionId", requireSessionSecret(store), (req, res) => {
    res.json(publicSession(req.session));
  });

  return router;
}
