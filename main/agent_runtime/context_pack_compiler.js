'use strict';

const util = require('util');

const {
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_ORDER,
  CONTEXT_PACK_SECTION_STATES,
  assertContextPackSection,
  createContextPackManifest,
  createContextPackSection,
} = require('./context_pack_contracts');

const CONTEXT_PACK_COMPILER_VERSION = 'context-pack-compiler.v1';
const DEFAULT_MAX_SUMMARY_CHARS = 12_000;
const DEFAULT_MAX_SECTION_SUMMARY_CHARS = 2_400;
const MIN_TOTAL_SUMMARY_CHARS = 256;
const MAX_TOTAL_SUMMARY_CHARS = 100_000;
const MIN_SECTION_SUMMARY_CHARS = 16;
const MAX_SECTION_SUMMARY_CHARS = 16_000;

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return null;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseSections(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > CONTEXT_PACK_SECTION_ORDER.length) {
    throw new TypeError('ContextPack compiler sections must be a bounded plain array');
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch {
    throw new TypeError('ContextPack compiler sections are invalid');
  }
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError('ContextPack compiler sections must be dense');
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('ContextPack compiler sections must contain data values');
    }
    return assertContextPackSection(descriptor.value);
  });
}

function boundedInteger(value, fieldName, minimum, maximum) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)
    || value < minimum || value > maximum) {
    throw new TypeError(`${fieldName} is outside the supported bounds`);
  }
  return value;
}

function clipSummary(value, limit) {
  if (value.length <= limit) return value;
  if (limit <= 1) return '…';
  const prefix = value.slice(0, limit - 1).trimEnd();
  return `${prefix.slice(0, limit - 1)}…`;
}

function unavailableSection(id) {
  return createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.UNAVAILABLE,
    revision: null,
    summary: '',
    citations: Object.freeze([]),
    truncated: false,
  });
}

function createContextPackCompiler(options = {}) {
  const optionFields = exactDataFields(
    options,
    ['now', 'maxSummaryChars', 'maxSectionSummaryChars'],
    []
  );
  if (!optionFields) throw new TypeError('Invalid ContextPack compiler options');
  const now = optionFields.has('now')
    ? optionFields.get('now')
    : () => new Date().toISOString();
  if (typeof now !== 'function' || util.types.isProxy(now)) {
    throw new TypeError('ContextPack compiler now must be a function');
  }
  const maxSummaryChars = boundedInteger(
    optionFields.has('maxSummaryChars')
      ? optionFields.get('maxSummaryChars')
      : DEFAULT_MAX_SUMMARY_CHARS,
    'ContextPack maxSummaryChars',
    MIN_TOTAL_SUMMARY_CHARS,
    MAX_TOTAL_SUMMARY_CHARS
  );
  const maxSectionSummaryChars = boundedInteger(
    optionFields.has('maxSectionSummaryChars')
      ? optionFields.get('maxSectionSummaryChars')
      : DEFAULT_MAX_SECTION_SUMMARY_CHARS,
    'ContextPack maxSectionSummaryChars',
    MIN_SECTION_SUMMARY_CHARS,
    MAX_SECTION_SUMMARY_CHARS
  );
  if (maxSectionSummaryChars > maxSummaryChars) {
    throw new TypeError('ContextPack section budget cannot exceed the total budget');
  }

  let compilations = 0;
  let lastPackId = null;

  function compile(input = {}) {
    const fields = exactDataFields(input, [
      'requestId',
      'projectId',
      'surface',
      'sections',
    ]);
    if (!fields) throw new TypeError('Invalid ContextPack compiler input');
    const supplied = denseSections(fields.get('sections'));
    const sectionById = new Map();
    for (const section of supplied) {
      if (sectionById.has(section.id)) {
        throw new TypeError(`Duplicate ContextPack section: ${section.id}`);
      }
      sectionById.set(section.id, section);
    }
    for (const requiredId of [
      CONTEXT_PACK_SECTION_IDS.REQUEST,
      CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
    ]) {
      const section = sectionById.get(requiredId);
      if (!section || ![
        CONTEXT_PACK_SECTION_STATES.AVAILABLE,
        CONTEXT_PACK_SECTION_STATES.STALE,
      ].includes(section.state)) {
        throw new TypeError(`ContextPack ${requiredId} section is required`);
      }
    }

    const ordered = CONTEXT_PACK_SECTION_ORDER.map(
      (id) => sectionById.get(id) || unavailableSection(id)
    );
    let remaining = maxSummaryChars;
    let summariesRemaining = ordered.filter((section) => section.summary.length > 0).length;
    const compiledSections = [];
    for (const section of ordered) {
      if (!section.summary) {
        compiledSections.push(section);
        continue;
      }
      summariesRemaining -= 1;
      const reserved = summariesRemaining;
      const sectionLimit = Math.max(
        1,
        Math.min(maxSectionSummaryChars, remaining - reserved)
      );
      const summary = clipSummary(section.summary, sectionLimit);
      const truncated = section.truncated || summary !== section.summary;
      const compiled = summary === section.summary && truncated === section.truncated
        ? section
        : createContextPackSection({
          id: section.id,
          state: section.state,
          revision: section.revision,
          summary,
          citations: section.citations,
          truncated,
        });
      compiledSections.push(compiled);
      remaining -= summary.length;
    }
    const frozenSections = Object.freeze(compiledSections);
    const usedSummaryChars = frozenSections.reduce(
      (total, section) => total + section.summary.length,
      0
    );
    const truncatedSections = Object.freeze(frozenSections
      .filter((section) => section.truncated)
      .map((section) => section.id));
    const citationChars = frozenSections.reduce(
      (total, section) => total + section.citations.reduce(
        (sectionTotal, citation) => (
          sectionTotal + citation.locator.length + citation.revision.length
        ),
        0
      ),
      0
    );
    let createdAt;
    try {
      createdAt = now();
    } catch {
      throw new TypeError('ContextPack compiler clock failed');
    }
    if (util.types.isPromise(createdAt)) {
      try {
        Reflect.apply(Promise.prototype.then, createdAt, [
          () => {},
          () => {},
        ]);
      } catch {
        // The value is rejected below regardless of settlement behavior.
      }
      throw new TypeError('ContextPack compiler clock must be synchronous');
    }
    const manifest = createContextPackManifest({
      requestId: fields.get('requestId'),
      projectId: fields.get('projectId'),
      surface: fields.get('surface'),
      createdAt,
      sections: frozenSections,
      budget: Object.freeze({
        maxSummaryChars,
        usedSummaryChars,
        estimatedTokens: Math.ceil((usedSummaryChars + citationChars + 256) / 4),
        truncatedSections,
      }),
    });
    compilations += 1;
    lastPackId = manifest.packId;
    return manifest;
  }

  function diagnostics() {
    return Object.freeze({
      version: CONTEXT_PACK_COMPILER_VERSION,
      compilations,
      lastPackId,
      maxSummaryChars,
      maxSectionSummaryChars,
    });
  }

  return Object.freeze({
    version: CONTEXT_PACK_COMPILER_VERSION,
    compile,
    diagnostics,
  });
}

module.exports = {
  CONTEXT_PACK_COMPILER_VERSION,
  createContextPackCompiler,
};
