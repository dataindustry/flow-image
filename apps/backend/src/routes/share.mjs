import express from "express";
import { publicSession } from "../lib/store.mjs";

function assertUsableSession(store, session, res) {
  if (!session) {
    res.status(403).json({ error: "wrong_share_token" });
    return false;
  }
  if (store.isExpired(session)) {
    res.status(410).json({ error: "expired_session" });
    return false;
  }
  return true;
}

export function shareRouter({ store }) {
  const router = express.Router();

  for (const mode of ["view", "edit", "owner"]) {
    router.get(`/${mode}/:token`, async (req, res) => {
      const session = await store.getSessionForCapability(mode, req.params.token);
      if (!assertUsableSession(store, session, res)) return;
      res.json(publicSession(session, mode));
    });
  }

  return router;
}
