const prisma = require('./prisma');
const { __test } = require('./area-matcher');

const MATCHER_VERSION = '1.0';

async function logMatchAttempt(input) {
  try {
    const outcome = input.match ? 'auto_matched' : 'unmatched';
    const normalizedAddress = __test.normalize(`${input.rawAddress1} ${input.rawAddress2 ?? ''}`);
    const matchedAreaName = input.match?.areaName || null;
    const matchedAreaNorm = matchedAreaName ? __test.normalize(matchedAreaName) || null : null;

    const row = await prisma.addressMatchLog.create({
      data: {
        shopId: input.shopId ?? null,
        orderId: input.orderId ?? null,
        rawAddress1: input.rawAddress1,
        rawAddress2: input.rawAddress2 ?? null,
        rawCity: input.rawCity ?? null,
        matchedCityId: input.matchedCityId ?? null,
        matchedAreaId: input.match?.areaId || null,
        matchMethod: input.match?.method ?? null,
        matchConfidence: input.match?.confidence ?? null,
        matchedZone: input.match?.zone ?? null,
        matchedAreaName,
        matchedAreaNorm,
        normalizedAddress: normalizedAddress || null,
        matcherVersion: MATCHER_VERSION,
        outcome,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error('[address-match-log] failed to log attempt:', err);
    return null;
  }
}

module.exports = { logMatchAttempt };
