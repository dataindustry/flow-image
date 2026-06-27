import express from "express";
import multer from "multer";
import { MAX_PNG_BYTES } from "../lib/config.mjs";
import { parsePngMeta } from "../lib/png.mjs";
import { requireSessionAccess, requireSessionSecret } from "./sessions.mjs";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PNG_BYTES,
    files: 1
  }
});

export function annotationsRouter({ store }) {
  const router = express.Router({ mergeParams: true });

  function collectResponse(session) {
    if (session.pair_id && session.annotations.length >= session.screenshots.length) {
      session.status = "collected";
      store.refreshPairSessionExpiry(session);
    }
    return {
      session_id: session.session_id,
      ready_count: session.annotations.length,
      review_url: `${store.publicBaseUrl}/s/${session.session_id}`,
      items: session.annotations
    };
  }

  router.post(
    "/:sessionId/annotations/collect",
    requireSessionAccess(store, { allowPairCode: true, allowLegacySecret: false }),
    async (req, res) => {
      const body = collectResponse(req.session);
      await store.saveSession(req.session);
      res.json(body);
    }
  );

  router.post(
    "/:sessionId/annotations/:screenshotId",
    requireSessionAccess(store, { allowDeviceToken: true, allowLegacySecret: true }),
    upload.single("merged_png"),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "missing_merged_png" });
          return;
        }
        parsePngMeta(req.file.buffer);
        const annotation = await store.saveMergedAnnotation(
          req.session,
          req.params.screenshotId,
          req.file.buffer
        );
        if (!annotation) {
          res.status(404).json({ error: "unknown_screenshot" });
          return;
        }
        res.json({ ...annotation, ready: true });
      } catch (error) {
        res.status(error.status ?? 500).json({ error: error.message });
      }
    }
  );

  router.get("/:sessionId/annotations/ready", requireSessionSecret(store), (req, res) => {
    res.json({
      session_id: req.session.session_id,
      ready_count: req.session.annotations.length,
      items: req.session.annotations
    });
  });

  return router;
}

export function annotationsRootRouter({ store }) {
  const router = express.Router();

  function collectResponse(session) {
    if (session.pair_id && session.annotations.length >= session.screenshots.length) {
      session.status = "collected";
      store.refreshPairSessionExpiry(session);
    }
    return {
      session_id: session.session_id,
      ready_count: session.annotations.length,
      review_url: `${store.publicBaseUrl}/s/${session.session_id}`,
      items: session.annotations
    };
  }

  router.post("/collect-latest", async (req, res) => {
    const pair = await store.getPairForCode(req.get("X-FlowImage-Pair-Code"));
    if (!pair) {
      res.status(403).json({ error: "wrong_pair_code" });
      return;
    }
    const sessions = await store.listSessionsForPair(pair.pair_id);
    const session = sessions.find((item) =>
      ["returned", "partially_returned", "collected"].includes(item.status)
    );
    if (!session) {
      res.status(404).json({ error: "no_returned_sessions" });
      return;
    }
    const body = collectResponse(session);
    await store.saveSession(session);
    res.json(body);
  });

  return router;
}
