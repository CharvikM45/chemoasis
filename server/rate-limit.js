// A simple in-memory limiter for the sign-in routes (counts per key in a fixed time window).
// Fine for one server; with several Railway replicas, move the counts to Postgres or Redis.
function createLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = now();
    for (const [key, entry] of hits) if (entry.reset <= t) hits.delete(key);
  }, windowMs);
  timer.unref();

  return {
    // Returns 0 if allowed, otherwise how many seconds to wait.
    hit(key) {
      const t = now();
      let entry = hits.get(key);
      if (!entry || entry.reset <= t) {
        entry = { count: 0, reset: t + windowMs };
        hits.set(key, entry);
      }
      entry.count++;
      return entry.count > limit ? Math.ceil((entry.reset - t) / 1000) : 0;
    },
    reset(key) {
      hits.delete(key);
    }
  };
}

module.exports = { createLimiter };
