// Bundled courier directory + name/code matchers. Swap the list for your own
// providers; every entry needs at least { id, name, courier_code, courier_name }.
// `possible_fields` drives the structured credential form; omit it to get a
// free-text "key: value" fallback in the onboarding UI.

const courier_companies = [
  {
    id: "tcs",
    name: "TCS Express",
    courier_code: "TCS",
    courier_name: "TCS Express",
    possible_matches: ["tcs", "tcs (overnight) pesh", "tcs (overland) pesh", "tcs express"],
    color: "#FF0000",
    logo: "https://trackmyorder.pk/TCS.svg",
  },
  {
    id: "leopards",
    name: "Leopards Courier",
    courier_code: "LCS",
    courier_name: "Leopards Courier",
    possible_matches: ["leopards", "leopards courier services", "lcs"],
    color: "#FFA500",
    logo: "https://trackmyorder.pk/leopards-logo.png",
  },
  {
    id: "mnp",
    name: "M&P Courier",
    courier_code: "MNP",
    courier_name: "M&P Courier",
    possible_matches: ["mnp", "m&p", "m & p", "mnp courier", "m&p courier", "M-P-Logistic"],
    color: "#ffffff",
    logo: "https://trackmyorder.pk/mnp-logo.png",
  },
  {
    id: "postex",
    name: "Postex",
    courier_code: "PST",
    courier_name: "Postex",
    possible_matches: ["postex", "pst", "post ex", "warsak - postex"],
    color: "#000000",
    logo: "https://trackmyorder.pk/postex-logo.png",
    possible_fields: [{ name: "Token", type: "string", save_key: "token" }],
  },
  {
    id: "speedaf",
    name: "Speedaf Express",
    courier_code: "SPD",
    courier_name: "Speedaf Express",
    possible_matches: ["speedaf", "speedaf courier services", "spd", "speedaf express"],
    color: "#ff9d36",
    logo: "https://trackmyorder.pk/speedaf-logo.png",
  },
  {
    id: "trax",
    name: "Trax",
    courier_code: "TRX",
    courier_name: "Trax",
    possible_matches: ["trax", "trx", "trax express", "trax courier"],
    color: "#FFFFFF",
    logo: "https://trackmyorder.pk/trax-logo.png",
  },
];

// Normalize for fuzzy matching: lowercase, trim, strip punctuation, collapse spaces.
function normalizeString(str) {
  if (typeof str !== "string") return "";
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// Exact match first, then prefix, then substring (>=3 chars) for flexibility.
function findCourier(companyName) {
  const normalized = normalizeString(companyName);
  if (!normalized) return null;

  for (const courier of courier_companies) {
    const matches = (courier.possible_matches || []).map(normalizeString);
    if (matches.includes(normalized)) return courier;
  }
  for (const courier of courier_companies) {
    const matches = (courier.possible_matches || []).map(normalizeString);
    for (const m of matches) {
      if (normalized.startsWith(m) || m.startsWith(normalized)) return courier;
    }
  }
  for (const courier of courier_companies) {
    const matches = (courier.possible_matches || []).map(normalizeString);
    for (const m of matches) {
      if (m.length >= 3 && normalized.includes(m)) return courier;
    }
  }
  return null;
}

function getCourierCode(companyName) {
  return findCourier(companyName)?.courier_code ?? "UNKNOWN";
}

function getCourierName(companyName) {
  return findCourier(companyName)?.courier_name ?? "Unknown";
}

function getCourierDetailsByCode(courier_code) {
  if (typeof courier_code !== "string") return null;
  const normalized = courier_code.toUpperCase().trim();
  return courier_companies.find((c) => c.courier_code === normalized) || null;
}

function getCourierNameByCode(courier_code) {
  return getCourierDetailsByCode(courier_code)?.courier_name ?? "Unknown";
}

export {
  courier_companies,
  findCourier,
  getCourierCode,
  getCourierName,
  getCourierDetailsByCode,
  getCourierNameByCode,
};
