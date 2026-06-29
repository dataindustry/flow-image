import express from "express";
import { rateLimitMiddleware } from "../lib/rate-limit.mjs";
import { publicSession } from "../lib/store.mjs";

function getViewToken(req) {
  return req.get("X-FlowImage-View-Token");
}

function getEditToken(req) {
  return req.get("X-FlowImage-Edit-Token");
}

function getOwnerToken(req) {
  return req.get("X-FlowImage-Owner-Token");
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

export function requireSessionAccess(
  store,
  { allowViewToken = false, allowEditToken = false, allowOwnerToken = false } = {}
) {
  return async function sessionAccessMiddleware(req, res, next) {
    if (allowOwnerToken && getOwnerToken(req)) {
      const session = await store.getSessionForCapabilityAndId(
        "owner",
        getOwnerToken(req),
        req.params.sessionId
      );
      if (!session) {
        res.status(403).json({ error: "wrong_owner_token" });
        return;
      }
      if (!assertUsableSession(store, session, res)) return;
      req.session = session;
      req.access = "owner";
      next();
      return;
    }

    if (allowEditToken && getEditToken(req)) {
      const session = await store.getSessionForCapabilityAndId(
        "edit",
        getEditToken(req),
        req.params.sessionId
      );
      if (!session) {
        res.status(403).json({ error: "wrong_edit_token" });
        return;
      }
      if (!assertUsableSession(store, session, res)) return;
      req.session = session;
      req.access = "edit";
      next();
      return;
    }

    if (allowViewToken && getViewToken(req)) {
      const session = await store.getSessionForCapabilityAndId(
        "view",
        getViewToken(req),
        req.params.sessionId
      );
      if (!session) {
        res.status(403).json({ error: "wrong_view_token" });
        return;
      }
      if (!assertUsableSession(store, session, res)) return;
      req.session = session;
      req.access = "view";
      next();
      return;
    }

    res.status(401).json({ error: "missing_auth" });
  };
}

export function sessionsRouter({ config, store }) {
  const router = express.Router();

  router.post(
    "/",
    rateLimitMiddleware(store, config.rateLimit, "create", "createLimit"),
    async (req, res) => {
      const title = String(req.body?.title ?? "").trim();
      if (!title || title.length > 120) {
        res.status(400).json({ error: "invalid_title" });
        return;
      }

      const created = await store.createSession({
        title,
        defaultPage: req.body?.default_page,
        idempotencyKey: req.body?.idempotency_key
      });
      const session = created.session;
      res.json({
        session_id: session.session_id,
        view_url: created.view_url,
        edit_url: created.edit_url,
        owner_url: created.owner_url,
        owner_token: created.owner_token,
        status: session.status,
        expires_at: session.expires_at,
        retention_hours: session.retention_hours
      });
    }
  );

  router.get(
    "/:sessionId",
    requireSessionAccess(store, {
      allowViewToken: true,
      allowEditToken: true,
      allowOwnerToken: true
    }),
    (req, res) => {
      res.json(publicSession(req.session, req.access));
    }
  );

  router.patch(
    "/:sessionId/retention",
    requireSessionAccess(store, { allowOwnerToken: true }),
    async (req, res) => {
      const session = await store.setRetention(req.session, {
        value: req.body?.value,
        unit: req.body?.unit
      });
      if (!session) {
        res.status(400).json({ error: "invalid_retention" });
        return;
      }
      res.json({
        session_id: session.session_id,
        expires_at: session.expires_at,
        retention_hours: session.retention_hours
      });
    }
  );

  return router;
}
