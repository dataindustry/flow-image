function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function sendLimited(res, retryAfterSeconds) {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "rate_limited",
    retry_after_seconds: retryAfterSeconds
  });
}

export function rateLimitMiddleware(store, config, bucket, limitKey, { byteLimitKey } = {}) {
  return function flowImageRateLimit(req, res, next) {
    if (!config.enabled) {
      next();
      return;
    }

    const key = `${bucket}:${clientKey(req)}`;
    const requestResult = store.consumeRateLimit(key, {
      limit: config[limitKey],
      windowMs: config.windowMs,
      cost: 1
    });
    if (!requestResult.allowed) {
      sendLimited(res, requestResult.retryAfterSeconds);
      return;
    }

    if (byteLimitKey) {
      const byteCost = Number(req.get("content-length") ?? 0);
      const byteResult = store.consumeRateLimit(`${bucket}:bytes:${clientKey(req)}`, {
        limit: config[byteLimitKey],
        windowMs: config.windowMs,
        byteCost
      });
      if (!byteResult.allowed) {
        sendLimited(res, byteResult.retryAfterSeconds);
        return;
      }
    }

    next();
  };
}
