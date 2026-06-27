import express from "express";
import multer from "multer";
import { MAX_PNG_BYTES } from "../lib/config.mjs";
import { parsePngMeta } from "../lib/png.mjs";
import { requireSessionSecret } from "./sessions.mjs";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PNG_BYTES,
    files: 1
  }
});

export function annotationsRouter({ store }) {
  const router = express.Router({ mergeParams: true });

  router.post(
    "/:sessionId/annotations/:screenshotId",
    requireSessionSecret(store),
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
