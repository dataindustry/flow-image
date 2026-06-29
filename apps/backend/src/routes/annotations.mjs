import express from "express";
import multer from "multer";
import { MAX_PNG_BYTES } from "../lib/config.mjs";
import { parsePngMeta } from "../lib/png.mjs";
import { rateLimitMiddleware } from "../lib/rate-limit.mjs";
import { publicAnnotation } from "../lib/store.mjs";
import { requireSessionAccess } from "./sessions.mjs";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PNG_BYTES,
    files: 1
  }
});

export function annotationsRouter({ config, store }) {
  const router = express.Router({ mergeParams: true });

  function collectResponse(session) {
    return {
      session_id: session.session_id,
      ready_count: session.annotations.length,
      items: session.annotations.map(publicAnnotation)
    };
  }

  router.post(
    "/:sessionId/annotations/collect",
    requireSessionAccess(store, { allowOwnerToken: true }),
    async (req, res) => {
      if (req.session.annotations.length >= req.session.screenshots.length) {
        req.session.status = "collected";
        req.session.updated_at = store.now().toISOString();
      }
      const body = collectResponse(req.session);
      await store.saveSession(req.session);
      res.json(body);
    }
  );

  router.post(
    "/:sessionId/annotations/:screenshotId",
    rateLimitMiddleware(store, config.rateLimit, "upload", "uploadRequestLimit", {
      byteLimitKey: "uploadBytesLimit"
    }),
    requireSessionAccess(store, { allowEditToken: true, allowOwnerToken: true }),
    upload.single("merged_png"),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "missing_merged_png" });
          return;
        }
        if (
          store.sessionStoredBytes(req.session.session_id, {
            replaceResultFor: req.params.screenshotId
          }) + req.file.buffer.length >
          config.rateLimit.sessionBytesLimit
        ) {
          res.status(413).json({ error: "session_storage_limit" });
          return;
        }
        const meta = parsePngMeta(req.file.buffer);
        const annotation = await store.saveMergedAnnotation(
          req.session,
          req.params.screenshotId,
          req.file.buffer,
          meta
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

  return router;
}
