import express from "express";
import { publicSession } from "../lib/store.mjs";

function getSecret(req) {
  return req.get("X-Session-Secret") ?? req.query.secret;
}

function getPairCode(req) {
  return req.get("X-FlowImage-Pair-Code");
}

function getPairDeviceToken(req) {
  return req.get("X-Pair-Device-Token");
}

function assertUsableSession(store, session, res) {
  if (!session) {
    res.status(404).json({ error: "unknown_session" });
    return false;
  }
  if (store.isExpired(session)) {
    res.status(410).json({ error: "expired_session" });
    return false;
  }
  return true;
}

export function requireSessionSecret(store) {
  return async function sessionSecretMiddleware(req, res, next) {
    const session = await store.getSession(req.params.sessionId);
    if (!assertUsableSession(store, session, res)) return;
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

export function requireSessionAccess(
  store,
  { allowPairCode = false, allowDeviceToken = false, allowLegacySecret = true } = {}
) {
  return async function sessionAccessMiddleware(req, res, next) {
    if (allowPairCode && getPairCode(req)) {
      const pair = await store.getPairForCode(getPairCode(req));
      if (!pair) {
        res.status(403).json({ error: "wrong_pair_code" });
        return;
      }
      const session = await store.getPairSession(pair.pair_id, req.params.sessionId);
      if (!assertUsableSession(store, session, res)) return;
      req.pair = pair;
      req.session = session;
      next();
      return;
    }

    if (allowDeviceToken && getPairDeviceToken(req)) {
      const result = await store.getPairForDeviceToken(getPairDeviceToken(req));
      if (!result) {
        res.status(403).json({ error: "wrong_pair_device_token" });
        return;
      }
      const session = await store.getPairSession(result.pair.pair_id, req.params.sessionId);
      if (!assertUsableSession(store, session, res)) return;
      req.pair = result.pair;
      req.pairDevice = result.device;
      req.session = session;
      next();
      return;
    }

    if (allowLegacySecret) {
      return requireSessionSecret(store)(req, res, next);
    }

    res.status(401).json({ error: "missing_auth" });
  };
}

export function sessionsRouter({ config, store }) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const title = String(req.body?.title ?? "").trim();
    if (!title || title.length > 120) {
      res.status(400).json({ error: "invalid_title" });
      return;
    }

    if (getPairCode(req)) {
      const pair = await store.getPairForCode(getPairCode(req));
      if (!pair) {
        res.status(403).json({ error: "wrong_pair_code" });
        return;
      }
      const session = await store.createSession({ title, pairId: pair.pair_id });
      res.json({
        session_id: session.session_id,
        viewer_url: session.viewer_url,
        status: session.status,
        expires_at: session.expires_at
      });
      return;
    }

    if (!config.bridgeToken || req.get("X-Bridge-Token") !== config.bridgeToken) {
      res.status(403).json({ error: "wrong_bridge_token" });
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

  router.get(
    "/:sessionId",
    requireSessionAccess(store, { allowDeviceToken: true, allowLegacySecret: true }),
    (req, res) => {
    res.json(publicSession(req.session));
    }
  );

  return router;
}
