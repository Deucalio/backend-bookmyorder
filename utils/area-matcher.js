const { distance } = require('fastest-levenshtein');
const prisma = require('./prisma');

const CONFIG = {
  STAGE1_MIN_AREA_LEN: 8,
  MIN_TOKEN_LEN: 3,
  MIN_STAGE2_TOKEN_LEN: 4,
  MIN_STAGE3_TOKEN_LEN: 4,
  FUZZY_THRESHOLD: 0.85,
  FUZZY_MAX_LEN_DIFF: 2,
  FUZZY_CONFIDENCE_PENALTY: 0.9,
};

// =============================================================================
// Address normalization
// =============================================================================

const SECTOR_RX = /\b([a-z])(?:-|\/|\s)?(\d{1,2})(?:[-/](\d{1,2}))?\b/gi;

function normalizeSectors(s) {
  return s.replace(SECTOR_RX, (match, letter, num, sub) => {
    const original = match;
    const isJoined = /^[a-z]\d/i.test(original);
    const isPunctuated = /^[a-z][-/]/i.test(original);
    if (!isJoined && !isPunctuated) return match;
    const base = `${letter.toLowerCase()}${num}`;
    return sub ? `${base}_${sub}` : base;
  });
}

const NOISE_RX = /[^\p{L}\p{N}\s_]/gu;
const CONNECTORS_RX = /\b(e|ul|al|i|wal|wala)\b/g;

const COMMON_TYPOS = [
  [/\bbahira\b/g, 'bahria'],
  [/\bmehmod/g, 'mehmood'],
  [/\bnazimbad\b/g, 'nazimabad'],
  [/\bsoilder\b/g, 'soldier'],
  [/\bkemari\b/g, 'keamari'],
  [/\bbufferzone\b/g, 'buffer zone'],
  [/\bgulistan e johar\b/g, 'gulistan-e-johar'],
  [/\bmehmood\s+abad\b/g, 'mehmoodabad'],
  [/\bnazmabad\b/g, 'nazimabad'],
  [/\bgulstan\b/g, 'gulistan'],
  [/\bsaaditown\b/g, 'saadi town'],
  [/\bscheme(\d)/g, 'scheme $1'],
];

function applyTypoFixes(s) {
  let out = s;
  for (const [rx, replacement] of COMMON_TYPOS) {
    out = out.replace(rx, replacement);
  }
  return out;
}

function normalize(s) {
  if (!s) return '';
  let out = s.toLowerCase();
  out = out.replace(
    /\b([a-z])\.([a-z])\.?([a-z])?\.?([a-z])?\.?([a-z])?\b/g,
    (_, a, b, c, d, e) => [a, b, c, d, e].filter(Boolean).join(''),
  );
  out = applyTypoFixes(out);
  out = normalizeSectors(out);
  out = out.replace(NOISE_RX, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(CONNECTORS_RX, '').replace(/\s+/g, ' ').trim();
  return out;
}

const STOPWORDS = new Set([
  'house', 'home', 'flat', 'plot', 'apt', 'apartment', 'floor', 'street',
  'st', 'road', 'rd', 'lane', 'gali', 'mohallah', 'muhalla', 'block',
  'sector', 'phase', 'town', 'colony', 'society', 'no', 'number', 'near',
  'opposite', 'opp', 'behind', 'shop', 'market', 'bazar', 'bazaar', 'plaza',
  'tower', 'main', 'side', 'pakistan', 'pak',
]);

const FUZZY_DENY_FIRST_TOKENS = new Set([
  'karachi', 'lahore', 'islamabad', 'faisalabad', 'multan', 'peshawar',
  'rawalpindi', 'gujranwala', 'sialkot', 'quetta', 'hyderabad',
  'korangi', 'malir', 'clifton', 'gulshan', 'gulistan',
  'nazimabad', 'landhi', 'orangi', 'saadi',
  'block', 'sector', 'phase', 'street', 'house', 'plot', 'flat',
  'main', 'colony', 'town', 'society', 'gali', 'lane', 'road',
  'muslim', 'green', 'new', 'old', 'north', 'south', 'east', 'west',
  'area', 'avenue', 'park', 'garden', 'city', 'centre', 'center',
  'apartment', 'tower', 'plaza', 'masjid', 'mosque',
]);

function tokenize(blob) {
  return blob.split(' ').filter((t) => t.length >= CONFIG.MIN_TOKEN_LEN && !STOPWORDS.has(t));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Indexed area loader
// =============================================================================

function indexAreaRow(a) {
  const primary = normalize(a.name);
  const aliasNorms = (a.aliases ?? [])
    .map((al) => normalize(al))
    .filter((n) => n.length > 0 && n !== primary);
  const allNorms = Array.from(
    new Set([primary, ...aliasNorms].filter((n) => n.length > 0)),
  );
  return {
    id: a.id,
    name: a.name,
    zone: a.zone,
    norm: primary,
    norms: allNorms,
    firstToken: primary.split(' ')[0] ?? '',
  };
}

async function loadAreasForCity(cityId) {
  const rows = await prisma.area.findMany({
    where: { cityId },
    select: { id: true, name: true, zone: true, aliases: true },
  });
  return rows.map(indexAreaRow);
}

async function loadAreasForCities(cityIds) {
  const unique = Array.from(new Set(cityIds));
  if (unique.length === 0) return new Map();

  const rows = await prisma.area.findMany({
    where: { cityId: { in: unique } },
    select: { id: true, cityId: true, name: true, zone: true, aliases: true },
  });

  const out = new Map();
  for (const id of unique) out.set(id, []);
  for (const row of rows) {
    const indexed = indexAreaRow(row);
    out.get(row.cityId)?.push(indexed);
  }
  return out;
}

// =============================================================================
// The matcher (pure sync)
// =============================================================================

function matchAreaWithIndex(areas, address1, address2, options = {}) {
  const minConfidence = options.minConfidence ?? 0;
  const blob = normalize(`${address1 ?? ''} ${address2 ?? ''}`);
  if (!blob) return null;
  if (areas.length === 0) return null;

  const gate = (match) => (match.confidence >= minConfidence ? match : null);

  const zonesInAddress = new Set();
  const allZones = new Set(areas.map((x) => x.zone).filter((z) => !!z));
  for (const z of allZones) {
    const zNorm = normalize(z);
    if (zNorm.length >= 3 && new RegExp(`\\b${escapeRegex(zNorm)}\\b`).test(blob)) {
      zonesInAddress.add(z);
    }
  }

  // Stage 1 — Substring scan
  const candidates = [];
  for (const a of areas) {
    for (const n of a.norms) {
      if (n.length >= CONFIG.STAGE1_MIN_AREA_LEN) {
        candidates.push({ area: a, norm: n });
      }
    }
  }
  candidates.sort((x, y) => y.norm.length - x.norm.length);

  for (const { area: a, norm: n } of candidates) {
    const rx = new RegExp(`\\b${escapeRegex(n)}\\b`);
    if (!rx.test(blob)) continue;

    let chosen = a;
    if (zonesInAddress.size > 0 && a.zone && !zonesInAddress.has(a.zone)) {
      const better = areas.find(
        (x) => x.norm === a.norm && x.zone && zonesInAddress.has(x.zone) && x.id !== a.id,
      );
      if (better) chosen = better;
    }

    const m = { areaId: chosen.id, areaName: chosen.name, zone: chosen.zone, confidence: 1.0, method: 'substring' };
    const gated = gate(m);
    if (gated) return gated;
    break;
  }

  // Stage 1.5 — Zone + short-area composite
  if (zonesInAddress.size > 0) {
    const shortCandidates = [];
    for (const a of areas) {
      if (!a.zone || !zonesInAddress.has(a.zone)) continue;
      for (const n of a.norms) {
        if (n.length >= 4 && n.length < CONFIG.STAGE1_MIN_AREA_LEN) {
          shortCandidates.push({ area: a, norm: n });
        }
      }
    }
    shortCandidates.sort((x, y) => y.norm.length - x.norm.length);

    for (const { area: a, norm: n } of shortCandidates) {
      const rx = new RegExp(`\\b${escapeRegex(n)}\\b`);
      if (rx.test(blob)) {
        const m = { areaId: a.id, areaName: a.name, zone: a.zone, confidence: 0.95, method: 'substring' };
        const gated = gate(m);
        if (gated) return gated;
        break;
      }
    }
  }

  // Stage 2 — Token scan
  const tokens = tokenize(blob);
  const tokenSet = new Set(tokens);

  for (const a of areas) {
    if (a.firstToken.length < CONFIG.MIN_STAGE2_TOKEN_LEN) continue;
    if (tokenSet.has(a.firstToken)) {
      const m = { areaId: a.id, areaName: a.name, zone: a.zone, confidence: 0.85, method: 'token' };
      const gated = gate(m);
      if (gated) return gated;
      break;
    }
  }

  // Stage 3 — Fuzzy
  let best = null;

  for (const a of areas) {
    const candidateTokens = a.norm.split(' ').filter((t) => t.length >= CONFIG.MIN_STAGE3_TOKEN_LEN);
    if (candidateTokens.length === 0) continue;

    const meaningfulCandidates = candidateTokens.filter((t) => !FUZZY_DENY_FIRST_TOKENS.has(t));
    if (meaningfulCandidates.length === 0) continue;
    if (meaningfulCandidates.length === 1 && meaningfulCandidates[0].length < 6) continue;

    let hits = 0;
    for (const ct of meaningfulCandidates) {
      let matched = false;
      for (const at of tokens) {
        if (Math.abs(at.length - ct.length) > CONFIG.FUZZY_MAX_LEN_DIFF) continue;
        const d = distance(at, ct);
        const score = 1 - d / Math.max(at.length, ct.length);
        if (score >= CONFIG.FUZZY_THRESHOLD) { matched = true; break; }
      }
      if (matched) hits++;
    }

    const required = Math.max(1, Math.ceil(meaningfulCandidates.length / 2));
    if (hits >= required) {
      const score = hits / meaningfulCandidates.length;
      if (!best || score > best.score) best = { area: a, score };
    }
  }

  if (best) {
    const m = {
      areaId: best.area.id, areaName: best.area.name, zone: best.area.zone,
      confidence: best.score * CONFIG.FUZZY_CONFIDENCE_PENALTY, method: 'fuzzy',
    };
    const gated = gate(m);
    if (gated) return gated;
  }

  // Stage 4 — Zone-only fallback
  const zoneSet = new Set(areas.map((a) => a.zone).filter((z) => !!z));
  const zonesByLen = [...zoneSet].sort((a, b) => b.length - a.length);

  for (const z of zonesByLen) {
    const zNorm = normalize(z);
    if (zNorm.length < CONFIG.MIN_TOKEN_LEN) continue;
    const rx = new RegExp(`\\b${escapeRegex(zNorm)}\\b`);
    if (rx.test(blob)) {
      const m = { areaId: '', areaName: '', zone: z, confidence: 0.6, method: 'zone-only' };
      const gated = gate(m);
      if (gated) return gated;
      break;
    }
  }

  return null;
}

async function matchArea(cityId, address1, address2, options = {}) {
  const areas = await loadAreasForCity(cityId);
  if (areas.length === 0) return null;
  return matchAreaWithIndex(areas, address1, address2, options);
}

module.exports = {
  matchArea,
  matchAreaWithIndex,
  loadAreasForCity,
  loadAreasForCities,
  __test: { normalize, normalizeSectors, tokenize },
};
