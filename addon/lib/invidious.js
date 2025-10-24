// addon/lib/invidious.js
// Lightweight helper that validates INVIDIOUS_BASE and exposes a safe getter.
// No blocking on require: validation runs in background and caches result.

const DEFAULT_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const CHECK_TIMEOUT_MS = 3000; // 3s timeout for reachability checks

const base = process.env.INVIDIOUS_BASE ? String(process.env.INVIDIOUS_BASE).replace(/\/$/, '') : null;

let available = false;
let lastChecked = 0;

async function probeBase() {
  if (!base) {
    available = false;
    lastChecked = Date.now();
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    // Try a lightweight GET to the base URL root. Some instances might block HEAD.
    const res = await fetch(base, { method: 'GET', signal: controller.signal });
    available = res.ok;
  } catch (err) {
    available = false;
  } finally {
    clearTimeout(timeout);
    lastChecked = Date.now();
  }
}

// Start initial probe (do not await)
if (base) {
  probeBase().catch(() => { /* ignore */ });
  // periodic re-probe
  setInterval(() => {
    probeBase().catch(() => {});
  }, DEFAULT_CHECK_INTERVAL_MS);
}

// Synchronous getter used by parseProps: returns a watch URL or null depending on cached availability
function getUrl(ytId) {
  if (!base || !available) return null;
  return `${base}/watch?v=${encodeURIComponent(ytId)}`;
}

// Optional: helper to check availability (async)
async function isAvailable() {
  // If lastChecked is older than interval, trigger a probe and wait a bit
  const age = Date.now() - lastChecked;
  if (!lastChecked || age > DEFAULT_CHECK_INTERVAL_MS) {
    await probeBase();
  }
  return available;
}

module.exports = {
  getUrl,
  isAvailable,
};
