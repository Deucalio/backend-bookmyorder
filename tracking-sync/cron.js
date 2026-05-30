// tracking-sync/cron.js
//
// Daily 3 AM PKT (= 22:00 UTC) schedule. node-cron evaluates the expression
// in the configured timezone, so the same string works regardless of the
// VPS's system clock (ours runs in UTC).

const cron = require('node-cron');
const { runTrackingSync } = require('./syncTracking');

function startTrackingSyncCron() {
  cron.schedule(
    '0 3 * * *',
    async () => {
      console.log('[tracking-sync] cron tick (3 AM PKT)');
      try {
        await runTrackingSync();
      } catch (err) {
        console.error('[tracking-sync] cron run threw:', err);
      }
    },
    { timezone: 'Asia/Karachi' },
  );
  console.log('[tracking-sync] cron scheduled at 03:00 Asia/Karachi');
}

module.exports = { startTrackingSyncCron };
