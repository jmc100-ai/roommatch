#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  BALCONY_OR_VIEW_FACTS,
  factsMeetMustSpec,
  buildMustHaveSpecFromDealbreakers,
  resolveMustRequireSpec,
  flattenMustHavesForUrl,
  firstMatchingOrFact,
  requirementMet,
} = require("../lib/must-have-spec");

const orView = BALCONY_OR_VIEW_FACTS;

assert.strictEqual(
  factsMeetMustSpec({ ergonomic_workspace: true }, [["private_balcony"], "ergonomic_workspace"]),
  false,
  "OR balcony group alone fails without view/balcony"
);
assert.strictEqual(
  factsMeetMustSpec(
    { skyline_view: true, ergonomic_workspace: true },
    [orView, "ergonomic_workspace"]
  ),
  true,
  "skyline + desk passes"
);
assert.strictEqual(
  factsMeetMustSpec(
    { private_balcony: true, ergonomic_workspace: true },
    [orView, "ergonomic_workspace"]
  ),
  true,
  "balcony + desk passes"
);
assert.strictEqual(
  factsMeetMustSpec(
    { green_view: true, ergonomic_workspace: true },
    [orView, "ergonomic_workspace"]
  ),
  false,
  "green_view excluded from OR group"
);

const specBalconyDesk = buildMustHaveSpecFromDealbreakers(["balcony", "work_desk"]);
assert.ok(Array.isArray(specBalconyDesk[0]), "balcony chip → OR group");
assert.strictEqual(specBalconyDesk[1], "ergonomic_workspace");
assert.deepStrictEqual(flattenMustHavesForUrl(specBalconyDesk), ["ergonomic_workspace"]);

const resolved = resolveMustRequireSpec({
  boopProfile: { dealbreakers: ["balcony", "work_desk"] },
  mustHavesQuery: ["private_balcony", "ergonomic_workspace"],
  hardFilterKeys: ["private_balcony"],
});
assert.strictEqual(resolved.length, 2, "dedup private_balcony when OR group present");
assert.ok(Array.isArray(resolved[0]));

assert.strictEqual(
  firstMatchingOrFact({ courtyard_view: true }, orView),
  "courtyard_view"
);
assert.strictEqual(requirementMet({ skyline_view: true }, orView), true);

console.log("test-must-have-spec: OK");
