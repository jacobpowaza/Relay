"use strict";

// Minimal, dependency-free semantic-version comparison. Handles the subset
// Relay needs: MAJOR.MINOR.PATCH with an optional prerelease tag (e.g.
// 1.2.3-beta.4). A version WITH a prerelease tag sorts below the same version
// without one, matching the SemVer spec. Build metadata (+...) is ignored.

/** @param {string} version @returns {{ main: [number, number, number]; pre: Array<string | number> } | null} */
function parse(version) {
  if (typeof version !== "string") return null;
  const cleaned = version.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(cleaned);
  if (match === null) return null;
  const pre = match[4] === undefined
    ? []
    : match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { main: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

/** @param {Array<string | number>} a @param {Array<string | number>} b @returns {number} */
function comparePre(a, b) {
  // Per SemVer: no prerelease > has prerelease.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = typeof ai === "number";
    const bNum = typeof bi === "number";
    if (aNum && bNum) {
      if (ai !== bi) return ai < bi ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers have lower precedence than alphanumeric
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * @param {string} a @param {string} b
 * @returns {number} -1 if a<b, 0 if equal, 1 if a>b. Unparseable inputs sort as equal.
 */
function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (pa === null || pb === null) return 0;
  for (let i = 0; i < 3; i += 1) {
    const av = pa.main[i] ?? 0;
    const bv = pb.main[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/** @param {string} a @param {string} b */
function gt(a, b) {
  return compare(a, b) > 0;
}

/** @param {string} a @param {string} b */
function gte(a, b) {
  return compare(a, b) >= 0;
}

/** @param {string} version @returns {boolean} */
function isPrerelease(version) {
  const parsed = parse(version);
  return parsed !== null && parsed.pre.length > 0;
}

/** @param {string} version @returns {boolean} */
function isValid(version) {
  return parse(version) !== null;
}

module.exports = { compare, gt, gte, isPrerelease, isValid, parse };
