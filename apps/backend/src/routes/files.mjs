import express from "express";
import path from "node:path";
import { requireSessionSecret } from "./sessions.mjs";

const SAFE_KIND = new Set(["screenshots", "annotations"]);

function hasUnsafeSegment(value) {
  return (
    !value ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("\0")
  );
}

export function filesRouter({ store }) {
  const router = express.Router();

  router.get(
    "/sessions/:sessionId/:kind/:fileName",
    requireSessionSecret(store),
    async (req, res) => {
      const { sessionId, kind, fileName } = req.params;
      if (hasUnsafeSegment(sessionId) || hasUnsafeSegment(kind) || hasUnsafeSegment(fileName)) {
        res.status(400).json({ error: "bad_path" });
        return;
      }
      if (!SAFE_KIND.has(kind) || !fileName.endsWith(".png")) {
        res.status(400).json({ error: "bad_path" });
        return;
      }

      const root = path.resolve(store.dataDir);
      const filePath = path.resolve(root, sessionId, kind, fileName);
      if (!filePath.startsWith(`${root}${path.sep}`)) {
        res.status(400).json({ error: "bad_path" });
        return;
      }

      res.type("image/png").sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
          res.status(error.statusCode ?? 404).json({ error: "file_not_found" });
        }
      });
    }
  );

  return router;
}
