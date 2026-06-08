/**
 * Must-have requirements: AND of entries; each entry is one fact (string) or OR group (string[]).
 * Shared by server search + browser (dual export at bottom).
 */

/** v1: exclude green_view — too loose in Mexico City. */
const BALCONY_OR_VIEW_FACTS = Object.freeze([
  "private_balcony",
  "juliette_balcony",
  "skyline_view",
  "water_view",
  "courtyard_view",
  "landmark_view",
]);

/** Chip ids → requirement metadata (Node + browser). */
const MUSTHAVE_CHIP_SPECS = Object.freeze([
  { id: "free_cancellation", fact: null },
  {
    id: "balcony",
    fact: null,
    orFacts: BALCONY_OR_VIEW_FACTS,
    requirementId: "balcony_or_view",
    label: "Balcony or view",
  },
  {
    id: "spa_bathroom",
    fact: null,
    seed: "spa-like bathroom, soaking tub, rainfall shower, marble vanity, generous counter space, double sinks",
  },
  {
    id: "spacious",
    fact: null,
    seed: "spacious hotel room, generous layout, open feel",
  },
  { id: "work_desk", fact: "ergonomic_workspace", label: "Work desk" },
]);

const REQUIREMENT_LABELS = Object.freeze({
  balcony_or_view: "Balcony or view",
  ergonomic_workspace: "Work desk",
});

function isOrGroup(req) {
  return Array.isArray(req);
}

function factsMeetMustSpec(features, spec) {
  if (!spec?.length) return true;
  const f = features || {};
  return spec.every((req) => {
    if (isOrGroup(req)) return req.some((k) => f[k] === true);
    return f[req] === true;
  });
}

function firstMatchingOrFact(features, orFacts) {
  const f = features || {};
  return (orFacts || []).find((k) => f[k] === true) || null;
}

function isBalconyOrViewGroup(req) {
  return (
    isOrGroup(req) &&
    req.length > 0 &&
    req.every((k) => BALCONY_OR_VIEW_FACTS.includes(k))
  );
}

function hasBalconyOrViewGroup(spec) {
  return (spec || []).some(isBalconyOrViewGroup);
}

function specIncludesFact(spec, fact) {
  return (spec || []).some((req) =>
    isOrGroup(req) ? req.includes(fact) : req === fact
  );
}

function flatFactsInSpec(spec) {
  const out = [];
  for (const req of spec || []) {
    if (isOrGroup(req)) out.push(...req);
    else out.push(req);
  }
  return out;
}

/** Flat single-fact requirements only (for must_haves URL — OR groups live in boop_profile). */
function flattenMustHavesForUrl(spec) {
  const out = [];
  for (const req of spec || []) {
    if (!isOrGroup(req) && req) out.push(req);
  }
  return [...new Set(out)];
}

function specFingerprint(spec) {
  const norm = (spec || []).map((r) =>
    isOrGroup(r) ? r.slice().sort().join("|") : r
  );
  return norm.join(";");
}

function normalizeMustHaveSpec(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (Array.isArray(r) ? r.filter(Boolean) : r))
    .filter((r) => (isOrGroup(r) ? r.length > 0 : !!r));
}

/**
 * Build spec from wizard dealbreakers (+ optional freetext-derived fact keys).
 * @param {string[]} dealbreakers
 * @param {string[]} [freetextFacts]
 */
function buildMustHaveSpecFromDealbreakers(dealbreakers, freetextFacts = []) {
  const picked = new Set(Array.isArray(dealbreakers) ? dealbreakers : []);
  const spec = [];

  for (const chip of MUSTHAVE_CHIP_SPECS) {
    if (!picked.has(chip.id)) continue;
    if (chip.orFacts?.length) spec.push([...chip.orFacts]);
    else if (chip.fact) spec.push(chip.fact);
  }

  const balconyChip = picked.has("balcony");
  for (const flag of freetextFacts || []) {
    if (!flag) continue;
    if (flag === "private_balcony" && balconyChip) continue;
    if (!specIncludesFact(spec, flag)) spec.push(flag);
  }

  return spec;
}

/**
 * Resolve final must-have spec: boop_profile > dealbreakers > URL > intent hard_filters (deduped).
 */
function resolveMustRequireSpec({
  boopProfile = null,
  mustHavesQuery = [],
  hardFilterKeys = [],
} = {}) {
  let spec = [];

  if (boopProfile?.mustHaveSpec?.length) {
    spec = normalizeMustHaveSpec(boopProfile.mustHaveSpec);
  } else if (boopProfile?.dealbreakers?.length) {
    spec = buildMustHaveSpecFromDealbreakers(boopProfile.dealbreakers);
  }

  const balconyOrView = hasBalconyOrViewGroup(spec);

  for (const k of mustHavesQuery || []) {
    if (!k) continue;
    if (k === "private_balcony" && balconyOrView) continue;
    if (!specIncludesFact(spec, k)) spec.push(k);
  }

  for (const k of hardFilterKeys || []) {
    if (!k) continue;
    if (k === "private_balcony" && balconyOrView) continue;
    if (balconyOrView && BALCONY_OR_VIEW_FACTS.includes(k) && k !== "private_balcony") continue;
    if (!specIncludesFact(spec, k)) spec.push(k);
  }

  return spec;
}

/** Display rows for match breakdown / debug. */
function mustHaveRequirementsFromSpec(spec) {
  return (spec || []).map((req) => {
    if (isBalconyOrViewGroup(req)) {
      return {
        id: "balcony_or_view",
        chipId: "balcony",
        label: REQUIREMENT_LABELS.balcony_or_view,
        orFacts: req,
      };
    }
    if (isOrGroup(req)) {
      return { id: req.join("_or_"), label: req.join(" or "), orFacts: req };
    }
    return {
      id: req,
      label: REQUIREMENT_LABELS[req] || req.replace(/_/g, " "),
      fact: req,
    };
  });
}

function requirementMet(features, req) {
  const f = features || {};
  if (isOrGroup(req)) return !!firstMatchingOrFact(f, req);
  return f[req] === true;
}

const api = {
  BALCONY_OR_VIEW_FACTS,
  MUSTHAVE_CHIP_SPECS,
  REQUIREMENT_LABELS,
  isOrGroup,
  factsMeetMustSpec,
  firstMatchingOrFact,
  hasBalconyOrViewGroup,
  specIncludesFact,
  flatFactsInSpec,
  flattenMustHavesForUrl,
  specFingerprint,
  normalizeMustHaveSpec,
  buildMustHaveSpecFromDealbreakers,
  resolveMustRequireSpec,
  mustHaveRequirementsFromSpec,
  requirementMet,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.RM_MUST_HAVE_SPEC = api;
}
