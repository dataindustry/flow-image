import express from "express";
import QRCode from "qrcode";
import { rateLimitMiddleware } from "../lib/rate-limit.mjs";

const MAX_QR_TEXT_LENGTH = 2048;

export function qrRouter({ config, store }) {
  const router = express.Router();

  router.post(
    "/",
    rateLimitMiddleware(store, config.rateLimit, "qr", "qrLimit"),
    async (req, res) => {
      const text = String(req.body?.text ?? "").trim();
      if (!text || text.length > MAX_QR_TEXT_LENGTH) {
        res.status(400).json({ error: "invalid_qr_text" });
        return;
      }

      const svg = await QRCode.toString(text, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M"
      });
      res.type("image/svg+xml").send(svg);
    }
  );

  return router;
}
