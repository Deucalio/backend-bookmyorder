// tracking-sync/syncTracking.js
//
// Daily tracking sync. Pulls every non-terminal Fulfillment that has a
// tracking number on a supported courier, batches it to the trackmyorder.pk
// /api/bmo/track-batch endpoint, upserts the returned events, and updates
// Fulfillment.lastTrackingStatus + .deliveryOutcome.
//
// Failure handling:
//   - In-run: each batch HTTP POST retries 4 times with exponential backoff
//     (1s → 2s → 4s → 8s) before giving up.
//   - Across runs: when all 4 retries fail, every fulfillment in that batch
//     is upserted into TrackingRetryQueue. Next day's sync drains the queue
//     first; a row that succeeds is deleted, one that keeps failing has
//     attemptCount incremented. At attemptCount >= 5 the row is flagged
//     permanentlyFailed and ignored until manually cleared.

const axios = require('axios');
const prisma = require('../utils/prisma');
const { findCourier } = require('../utils/courierCompanies');
const { deliveryOutcomeFor, TERMINAL_STATUSES } = require('./statusMap');

const TRACK_API_URL =
  process.env.TRACKMYORDER_API_URL || 'https://backend.trackmyorder.pk/api/bmo/track-batch';
const CHUNK = 50;
const IN_RUN_MAX_ATTEMPTS = 5; // 1 initial + 4 retries
const CRON_RUN_CAP = 5; // permanentlyFailed after this many cron runs
const TERMINAL_LIST = Array.from(TERMINAL_STATUSES);

/**
 * Eligible fulfillments = has trackingNumber + supported courier + not in a
 * terminal tracking state + not locally cancelled. Initial-backfill orders
 * naturally drop out because they don't have our tracking numbers attached.
 */
async function loadEligibleFulfillments({ fulfillmentIds } = {}) {
  const where = {
    trackingNumber: { not: null },
    courierCode: { in: ['leopards', 'tcs'] },
    status: { notIn: ['cancelled', 'failed'] },
    OR: [
      { lastTrackingStatus: null },
      { lastTrackingStatus: { notIn: TERMINAL_LIST } },
    ],
  };
  if (fulfillmentIds?.length) {
    where.id = { in: fulfillmentIds };
    // Explicit fulfillmentIds override the terminal filter — the user wants
    // to re-sync these specific rows even if they're already DELIVERED.
    delete where.OR;
    delete where.status;
  }
  return prisma.fulfillment.findMany({
    where,
    select: { id: true, courierCode: true, trackingNumber: true },
  });
}

/** Drain TrackingRetryQueue: returns fulfillments from non-permanent rows. */
async function loadRetryQueueFulfillments() {
  const rows = await prisma.trackingRetryQueue.findMany({
    where: { permanentlyFailed: false },
    select: {
      fulfillmentId: true,
      fulfillment: {
        select: { id: true, courierCode: true, trackingNumber: true },
      },
    },
  });
  return rows
    .map((r) => r.fulfillment)
    .filter((f) => f && f.trackingNumber && ['leopards', 'tcs'].includes(f.courierCode));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST the batch, retry 4 times on HTTP failure (5 total attempts). */
async function postBatchWithRetry(items) {
  let lastErr = null;
  for (let attempt = 1; attempt <= IN_RUN_MAX_ATTEMPTS; attempt++) {
    try {
      const { data } = await axios.post(TRACK_API_URL, { items }, { timeout: 120_000 });
      return { ok: true, data };
    } catch (err) {
      lastErr = err;
      const msg = err.response ? `HTTP ${err.response.status}` : err.code || err.message;
      console.warn(`[tracking-sync] batch attempt ${attempt}/${IN_RUN_MAX_ATTEMPTS} failed: ${msg}`);
      if (attempt < IN_RUN_MAX_ATTEMPTS) {
        await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s, 8s
      }
    }
  }
  return { ok: false, error: lastErr };
}

/**
 * Persist events + roll up status for one fulfillment. Skips UNKNOWN events
 * (the upstream sends timezone-skewed duplicates with UNKNOWN status). If
 * the API returned zero events we still update lastTrackingAt so the row
 * doesn't stay in a "never synced" limbo.
 */
async function persistResult(fulfillmentId, result) {
  const events = (result.events || []).filter((e) => e.status && e.status !== 'UNKNOWN');

  await prisma.$transaction(async (tx) => {
    for (const e of events) {
      const eventAt = new Date(e.datetime?.replace(' ', 'T') + 'Z');
      if (Number.isNaN(eventAt.getTime())) continue;
      await tx.trackingEvent.upsert({
        where: {
          fulfillmentId_eventAt_description: {
            fulfillmentId,
            eventAt,
            description: e.description ?? '',
          },
        },
        create: {
          fulfillmentId,
          normalizedStatus: e.status,
          description: e.description ?? null,
          receiver: e.receiver ?? null,
          reason: e.reason ?? null,
          eventAt,
          rawData: e,
        },
        update: {
          normalizedStatus: e.status,
          receiver: e.receiver ?? null,
          reason: e.reason ?? null,
          rawData: e,
        },
      });
    }

    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        lastTrackingStatus: result.status || null,
        lastTrackingAt: new Date(),
        deliveryOutcome: deliveryOutcomeFor(result.status),
      },
    });
  });
}

/** Add fulfillments to the retry queue (or increment if already present). */
async function pushToRetryQueue(fulfillmentIds, errorMessage) {
  for (const id of fulfillmentIds) {
    const existing = await prisma.trackingRetryQueue.findUnique({
      where: { fulfillmentId: id },
    });
    const nextAttempt = (existing?.attemptCount ?? 0) + 1;
    await prisma.trackingRetryQueue.upsert({
      where: { fulfillmentId: id },
      create: {
        fulfillmentId: id,
        attemptCount: 1,
        lastError: errorMessage,
        lastAttemptAt: new Date(),
      },
      update: {
        attemptCount: nextAttempt,
        lastError: errorMessage,
        lastAttemptAt: new Date(),
        permanentlyFailed: nextAttempt >= CRON_RUN_CAP,
      },
    });
  }
}

/** Remove rows from the retry queue (called after a successful sync). */
async function clearFromRetryQueue(fulfillmentIds) {
  if (!fulfillmentIds.length) return;
  await prisma.trackingRetryQueue.deleteMany({
    where: { fulfillmentId: { in: fulfillmentIds } },
  });
}

/**
 * Main entry. Optional opts.fulfillmentIds restricts the run to specific
 * fulfillments (for /api/admin/sync-tracking manual triggers).
 */
async function runTrackingSync(opts = {}) {
  const startedAt = Date.now();
  const summary = {
    eligible: 0,
    queueDrained: 0,
    succeeded: 0,
    perItemFailed: 0,
    batchesFailed: 0,
    eventsWritten: 0,
  };

  // 1. Build the working set: queue drain + normal eligible (deduped).
  const queueRows = opts.fulfillmentIds ? [] : await loadRetryQueueFulfillments();
  const normal = await loadEligibleFulfillments({ fulfillmentIds: opts.fulfillmentIds });
  summary.queueDrained = queueRows.length;
  summary.eligible = normal.length;

  const seen = new Set();
  const working = [];
  for (const f of [...queueRows, ...normal]) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    working.push(f);
  }

  if (working.length === 0) {
    console.log('[tracking-sync] nothing to sync');
    return { ...summary, durationMs: Date.now() - startedAt };
  }

  console.log(
    `[tracking-sync] starting | ${working.length} fulfillments (${summary.queueDrained} from queue, ${summary.eligible} eligible)`,
  );

  // 2. Walk chunks sequentially. Per-batch isolation: one failed batch
  // doesn't kill the rest.
  const batches = chunk(working, CHUNK);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const items = batch.map((f) => ({
      courier_code: findCourier(f.courierCode)?.courier_code,
      tracking_number: f.trackingNumber,
    }));

    const { ok, data, error } = await postBatchWithRetry(items);
    if (!ok) {
      summary.batchesFailed += 1;
      console.error(
        `[tracking-sync] batch ${i + 1}/${batches.length} permanently failed in this run; queueing ${batch.length} for retry`,
      );
      await pushToRetryQueue(
        batch.map((f) => f.id),
        error?.response ? `HTTP ${error.response.status}` : error?.code || error?.message || 'unknown',
      );
      continue;
    }

    // 3. Persist per-item. Build a lookup so we can map result → fulfillmentId.
    const byTracking = new Map(batch.map((f) => [f.trackingNumber, f.id]));
    const successIds = [];
    for (const r of data.results || []) {
      const fulfillmentId = byTracking.get(r.tracking_number);
      if (!fulfillmentId) continue;
      if (!r.success) {
        summary.perItemFailed += 1;
        // Per-item failures intentionally aren't queued — they'll be picked
        // up by the next cron run since their lastTrackingStatus stays
        // non-terminal.
        continue;
      }
      try {
        await persistResult(fulfillmentId, r);
        summary.eventsWritten += (r.events || []).filter((e) => e.status && e.status !== 'UNKNOWN').length;
        summary.succeeded += 1;
        successIds.push(fulfillmentId);
      } catch (e) {
        console.error(`[tracking-sync] persist failed for ${fulfillmentId}:`, e.message);
      }
    }

    // 4. Anything from the queue that just succeeded → drop from queue.
    await clearFromRetryQueue(successIds);

    console.log(
      `[tracking-sync] batch ${i + 1}/${batches.length} done | ${data.results?.length ?? 0} results`,
    );
  }

  summary.durationMs = Date.now() - startedAt;
  console.log(`[tracking-sync] complete |`, summary);
  return summary;
}

module.exports = { runTrackingSync };
