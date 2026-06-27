import express from "express";

function publicPair(pair, sessions = []) {
  return {
    pair_id: pair.pair_id,
    display_name: pair.display_name,
    created_at: pair.created_at,
    last_seen_at: pair.last_seen_at,
    sessions: sessions.map((session) => ({
      session_id: session.session_id,
      title: session.title,
      status: session.status,
      created_at: session.created_at,
      updated_at: session.updated_at,
      expires_at: session.expires_at,
      screenshots: session.screenshots,
      annotations: session.annotations
    }))
  };
}

export function pairsRouter({ store }) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const { pair, pair_code, pair_device_token } = await store.createPair({
      label: req.body?.label
    });
    res.json({
      pair_id: pair.pair_id,
      pair_code,
      pair_device_token
    });
  });

  router.post("/bind-device", async (req, res) => {
    const result = await store.bindDeviceByPairCode({
      pairCode: req.body?.pair_code,
      label: req.body?.label
    });
    if (!result) {
      res.status(403).json({ error: "wrong_pair_code" });
      return;
    }
    res.json({
      pair_id: result.pair.pair_id,
      pair_device_token: result.pair_device_token
    });
  });

  router.get("/current", async (req, res) => {
    const token = req.get("X-Pair-Device-Token");
    if (!token) {
      res.status(401).json({ error: "missing_pair_device_token" });
      return;
    }
    const result = await store.getPairForDeviceToken(token);
    if (!result) {
      res.status(403).json({ error: "wrong_pair_device_token" });
      return;
    }
    const sessions = await store.listSessionsForPair(result.pair.pair_id);
    res.json(publicPair(result.pair, sessions));
  });

  router.post("/rotate-code", async (req, res) => {
    const token = req.get("X-Pair-Device-Token");
    if (!token) {
      res.status(401).json({ error: "missing_pair_device_token" });
      return;
    }
    const result = await store.rotatePairCode({ deviceToken: token });
    if (!result) {
      res.status(403).json({ error: "wrong_pair_device_token" });
      return;
    }
    res.json({
      pair_id: result.pair.pair_id,
      pair_code: result.pair_code
    });
  });

  return router;
}
