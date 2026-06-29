import express from "express";
import multer from "multer";
import { MAX_PNG_BYTES, MAX_SCREENSHOTS } from "../lib/config.mjs";
import { parsePngMeta } from "../lib/png.mjs";
import { rateLimitMiddleware } from "../lib/rate-limit.mjs";
import { requireSessionAccess } from "./sessions.mjs";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PNG_BYTES,
    files: MAX_SCREENSHOTS
  }
});

export function screenshotsRouter({ config, store }) {
  const router = express.Router({ mergeParams: true });

  router.post(
    "/:sessionId/screenshots",
    rateLimitMiddleware(store, config.rateLimit, "upload", "uploadRequestLimit", {
      byteLimitKey: "uploadBytesLimit"
    }),
    requireSessionAccess(store, { allowOwnerToken: true }),
    upload.array("files[]", MAX_SCREENSHOTS),
    async (req, res) => {
      try {
        const files = req.files ?? [];
        if (!files.length) {
          res.status(400).json({ error: "missing_files" });
          return;
        }
        if (req.session.screenshots.length + files.length > MAX_SCREENSHOTS) {
          res.status(413).json({ error: "too_many_files" });
          return;
        }
        const incomingBytes = files.reduce((total, file) => total + file.buffer.length, 0);
        if (
          store.sessionStoredBytes(req.session.session_id) + incomingBytes >
          config.rateLimit.sessionBytesLimit
        ) {
          res.status(413).json({ error: "session_storage_limit" });
          return;
        }
        const rawLabels = req.body["labels[]"] ?? req.body.labels;
        const labels = Array.isArray(rawLabels) ? rawLabels : rawLabels ? [rawLabels] : [];
        const normalized = files.map((file, index) => {
          const meta = parsePngMeta(file.buffer);
          return {
            buffer: file.buffer,
            label: labels[index] ?? "",
            ...meta
          };
        });
        const items = await store.addScreenshots(req.session, normalized);
        res.json({ session_id: req.session.session_id, count: items.length, items });
      } catch (error) {
        res.status(error.status ?? 500).json({ error: error.message });
      }
    }
  );

  return router;
}
