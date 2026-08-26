const defaultCrypto = require('crypto');
const defaultFs = require('fs');
const defaultPath = require('path');
const util = require('util');

const {
  canonicalizeMapChatProposalPatch,
  computeMapChatProposalPatchDigest,
} = require('./map_chat_proposal_store');

const APPLICATION_MAP_PATCH_SCHEMA_VERSION = 'application-map-patch.v1';
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const APPROVED_PROPOSAL_INPUT_KEYS = Object.freeze([
  'expectedDigest',
  'patch',
  'patchDigest',
]);
const APPROVED_PROPOSAL_PATCH_KEYS = Object.freeze([
  'operations',
  'schemaVersion',
]);
const APPLICATION_MAP_PROPOSAL_REASONS = Object.freeze({
  INVALID_INPUT: 'APPLICATION_MAP_PROPOSAL_INVALID_INPUT',
  INVALID_PATCH: 'APPLICATION_MAP_PROPOSAL_INVALID_PATCH',
  PATCH_DIGEST_MISMATCH: 'APPLICATION_MAP_PROPOSAL_PATCH_DIGEST_MISMATCH',
  STALE_BASE: 'APPLICATION_MAP_PROPOSAL_STALE_BASE',
  WRITE_FAILED: 'APPLICATION_MAP_PROPOSAL_WRITE_FAILED',
});

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function exactDataFields(value, expectedKeys) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function isDenseBoundedArray(value, maximum, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || (!allowEmpty && value.length === 0)) return false;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  return keys.length === value.length
    && keys.every((key, index) => key === String(index));
}

function isSafeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value);
}

function isBoundedText(value, maximum = 32_768) {
  return typeof value === 'string' && !value.includes('\0') && value.length <= maximum;
}

function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && !Object.is(value, -0) && Math.abs(value) <= 1_000_000_000;
}

function isValidAssetReference(value) {
  if (!isBoundedText(value) || !value || value.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments[0] === 'Map assets'
    && segments.length >= 3
    && segments.every((segment) => segment && segment !== '.' && segment !== '..');
}

function isValidNode(node) {
  if (!isPlainRecord(node) || !isSafeIdentifier(node.id)) return false;
  if (Object.hasOwn(node, 'parentId') && node.parentId !== null
    && !isSafeIdentifier(node.parentId)) return false;
  if (Object.hasOwn(node, 'type') && !isBoundedText(node.type, 256)) return false;
  if (Object.hasOwn(node, 'title') && !isBoundedText(node.title, 4_096)) return false;
  if (Object.hasOwn(node, 'assetId') && !isValidAssetReference(node.assetId)) return false;
  return true;
}

function isValidEdge(edge) {
  return isPlainRecord(edge)
    && isSafeIdentifier(edge.id)
    && isSafeIdentifier(edge.sourceNodeId)
    && isSafeIdentifier(edge.targetNodeId);
}

function isValidViewport(viewport) {
  const fields = exactDataFields(viewport, ['x', 'y', 'zoom']);
  return Boolean(fields
    && isFiniteCoordinate(fields.get('x'))
    && isFiniteCoordinate(fields.get('y'))
    && typeof fields.get('zoom') === 'number'
    && Number.isFinite(fields.get('zoom'))
    && fields.get('zoom') >= 0.05
    && fields.get('zoom') <= 16);
}

function validateMapGraph(map) {
  if (!isPlainRecord(map)
    || !isDenseBoundedArray(map.nodes, 20_000)
    || !isDenseBoundedArray(map.edges, 40_000)) return false;
  const nodeIds = new Set();
  const nodesById = new Map();
  for (const node of map.nodes) {
    if (!isValidNode(node) || nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
    nodesById.set(node.id, node);
  }
  const edgeIds = new Set();
  for (const edge of map.edges) {
    if (!isValidEdge(edge) || edgeIds.has(edge.id)
      || !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) return false;
    edgeIds.add(edge.id);
  }
  for (const node of map.nodes) {
    if (node.parentId !== undefined && node.parentId !== null
      && (!nodeIds.has(node.parentId) || node.parentId === node.id)) return false;
    const visited = new Set([node.id]);
    let cursor = node;
    while (cursor && cursor.parentId !== undefined && cursor.parentId !== null) {
      if (visited.has(cursor.parentId)) return false;
      visited.add(cursor.parentId);
      cursor = nodesById.get(cursor.parentId);
    }
  }
  if (!isPlainRecord(map.viewport)
    || !isFiniteCoordinate(map.viewport.x) || !isFiniteCoordinate(map.viewport.y)) return false;
  if (Object.hasOwn(map, 'zoom')
    && (typeof map.zoom !== 'number' || !Number.isFinite(map.zoom)
      || map.zoom < 0.05 || map.zoom > 16)) return false;
  return true;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createApplicationMapService(dependencies = {}) {
  const crypto = dependencies.crypto || defaultCrypto;
  const fs = dependencies.fs || defaultFs;
  const path = dependencies.path || defaultPath;

  function ensureFaberDir(rootPath) {
    const faberDir = path.join(rootPath, '.faber');
    if (!fs.existsSync(faberDir)) {
      fs.mkdirSync(faberDir, { recursive: true });
    }
    return faberDir;
  }

  function getMapPath(rootPath, { ensure = true } = {}) {
    const faberDir = ensure ? ensureFaberDir(rootPath) : path.join(rootPath, '.faber');
    return path.join(faberDir, 'application-map.json');
  }

  function readApplicationMapSnapshot(rootPath) {
    const mapPath = getMapPath(rootPath, { ensure: false });
    if (!fs.existsSync(mapPath)) {
      return { ok: true, found: false, map: null, contentDigest: null };
    }
    try {
      const content = fs.readFileSync(mapPath, 'utf8');
      return {
        ok: true,
        found: true,
        map: JSON.parse(content),
        contentDigest: `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`,
      };
    } catch {
      return {
        ok: false,
        found: true,
        map: null,
        contentDigest: null,
        reason: 'invalid_application_map',
      };
    }
  }

  function getMap(rootPath) {
    const snapshot = readApplicationMapSnapshot(rootPath);
    if (snapshot.ok && snapshot.found) {
      const map = cloneJson(snapshot.map);
      const viewport = isPlainRecord(map.viewport) ? map.viewport : {};
      if (!Object.hasOwn(map, 'zoom')
        && typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
        map.zoom = viewport.zoom;
        map.viewport = { ...viewport };
        delete map.viewport.zoom;
      }
      return map;
    }
    return {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0 },
      zoom: 1,
      updatedAt: new Date().toISOString(),
    };
  }

  function saveMap(rootPath, mapData) {
    const mapPath = getMapPath(rootPath);
    const source = isPlainRecord(mapData) ? mapData : {};
    const sourceViewport = isPlainRecord(source.viewport) ? source.viewport : {};
    const sourceZoom = typeof source.zoom === 'number' && Number.isFinite(source.zoom)
      ? source.zoom
      : sourceViewport.zoom;
    const data = {
      nodes: Array.isArray(source.nodes) ? cloneJson(source.nodes) : [],
      edges: Array.isArray(source.edges) ? cloneJson(source.edges) : [],
      viewport: {
        x: isFiniteCoordinate(sourceViewport.x) ? sourceViewport.x : 0,
        y: isFiniteCoordinate(sourceViewport.y) ? sourceViewport.y : 0,
      },
      zoom: typeof sourceZoom === 'number' && Number.isFinite(sourceZoom)
        && sourceZoom >= 0.05 && sourceZoom <= 16
        ? sourceZoom
        : 1,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(mapPath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, map: data };
  }

  function applyApprovedProposal(rootPath, rawInput) {
    let fields;
    let patch;
    try {
      fields = exactDataFields(rawInput, APPROVED_PROPOSAL_INPUT_KEYS);
      if (!fields) throw new TypeError('approved proposal input is invalid');
      const expectedDigest = fields.get('expectedDigest');
      const suppliedPatchDigest = fields.get('patchDigest');
      if (expectedDigest !== null
        && (typeof expectedDigest !== 'string' || !SAFE_DIGEST.test(expectedDigest))) {
        throw new TypeError('expectedDigest is invalid');
      }
      if (typeof suppliedPatchDigest !== 'string' || !SAFE_DIGEST.test(suppliedPatchDigest)) {
        throw new TypeError('patchDigest is invalid');
      }
      patch = canonicalizeMapChatProposalPatch(fields.get('patch'));
      const patchFields = exactDataFields(patch, APPROVED_PROPOSAL_PATCH_KEYS);
      if (!patchFields
        || patchFields.get('schemaVersion') !== APPLICATION_MAP_PATCH_SCHEMA_VERSION
        || !isDenseBoundedArray(patchFields.get('operations'), 500, { allowEmpty: false })) {
        throw new TypeError('approved application map patch is invalid');
      }
    } catch {
      return { ok: false, code: APPLICATION_MAP_PROPOSAL_REASONS.INVALID_INPUT };
    }

    if (computeMapChatProposalPatchDigest(patch) !== fields.get('patchDigest')) {
      return {
        ok: false,
        code: APPLICATION_MAP_PROPOSAL_REASONS.PATCH_DIGEST_MISMATCH,
      };
    }

    const current = readApplicationMapSnapshot(rootPath);
    if (!current || current.ok !== true) {
      return { ok: false, code: APPLICATION_MAP_PROPOSAL_REASONS.WRITE_FAILED };
    }
    if (current.contentDigest !== fields.get('expectedDigest')) {
      return { ok: false, code: APPLICATION_MAP_PROPOSAL_REASONS.STALE_BASE };
    }

    const nextMap = current.found
      ? cloneJson(current.map)
      : { nodes: [], edges: [], viewport: { x: 0, y: 0 }, zoom: 1 };
    if (!validateMapGraph(nextMap)) {
      return { ok: false, code: APPLICATION_MAP_PROPOSAL_REASONS.WRITE_FAILED };
    }

    const timestamp = new Date().toISOString();
    try {
      for (const operation of patch.operations) {
        if (!isPlainRecord(operation) || !isBoundedText(operation.kind, 64)) {
          throw new TypeError('map operation is invalid');
        }
        if (operation.kind === 'upsert_node') {
          const operationFields = exactDataFields(operation, ['kind', 'node']);
          if (!operationFields || !isValidNode(operationFields.get('node'))) {
            throw new TypeError('upsert_node is invalid');
          }
          const proposed = cloneJson(operationFields.get('node'));
          const index = nextMap.nodes.findIndex((node) => node.id === proposed.id);
          const existing = index >= 0 ? nextMap.nodes[index] : null;
          delete proposed.createdAt;
          delete proposed.updatedAt;
          const node = {
            ...proposed,
            createdAt: existing && existing.createdAt ? existing.createdAt : timestamp,
            updatedAt: timestamp,
          };
          if (index >= 0) nextMap.nodes[index] = node;
          else nextMap.nodes.push(node);
        } else if (operation.kind === 'remove_node') {
          const operationFields = exactDataFields(operation, ['kind', 'nodeId']);
          if (!operationFields || !isSafeIdentifier(operationFields.get('nodeId'))) {
            throw new TypeError('remove_node is invalid');
          }
          const nodeId = operationFields.get('nodeId');
          nextMap.nodes = nextMap.nodes
            .filter((node) => node.id !== nodeId)
            .map((node) => {
              if (node.parentId !== nodeId) return node;
              const reparented = { ...node, updatedAt: timestamp };
              delete reparented.parentId;
              return reparented;
            });
          nextMap.edges = nextMap.edges.filter(
            (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
          );
        } else if (operation.kind === 'upsert_edge') {
          const operationFields = exactDataFields(operation, ['edge', 'kind']);
          if (!operationFields || !isValidEdge(operationFields.get('edge'))) {
            throw new TypeError('upsert_edge is invalid');
          }
          const proposed = cloneJson(operationFields.get('edge'));
          const index = nextMap.edges.findIndex((edge) => edge.id === proposed.id);
          const existing = index >= 0 ? nextMap.edges[index] : null;
          delete proposed.createdAt;
          delete proposed.updatedAt;
          const edge = {
            ...proposed,
            createdAt: existing && existing.createdAt ? existing.createdAt : timestamp,
            updatedAt: timestamp,
          };
          if (index >= 0) nextMap.edges[index] = edge;
          else nextMap.edges.push(edge);
        } else if (operation.kind === 'remove_edge') {
          const operationFields = exactDataFields(operation, ['edgeId', 'kind']);
          if (!operationFields || !isSafeIdentifier(operationFields.get('edgeId'))) {
            throw new TypeError('remove_edge is invalid');
          }
          nextMap.edges = nextMap.edges.filter(
            (edge) => edge.id !== operationFields.get('edgeId'),
          );
        } else if (operation.kind === 'set_viewport') {
          const operationFields = exactDataFields(operation, ['kind', 'viewport']);
          const viewport = operationFields && operationFields.get('viewport');
          if (!operationFields || !isValidViewport(viewport)) {
            throw new TypeError('set_viewport is invalid');
          }
          nextMap.viewport = { x: viewport.x, y: viewport.y };
          nextMap.zoom = viewport.zoom;
        } else {
          throw new TypeError('unsupported map operation');
        }
      }
      nextMap.updatedAt = timestamp;
      if (!validateMapGraph(nextMap)) throw new TypeError('resulting map graph is invalid');
    } catch {
      return { ok: false, code: APPLICATION_MAP_PROPOSAL_REASONS.INVALID_PATCH };
    }

    let mapPath = null;
    let hadPreviousFile = false;
    let previousBytes = null;
    try {
      mapPath = getMapPath(rootPath);
      hadPreviousFile = current.found && fs.existsSync(mapPath);
      if (hadPreviousFile) previousBytes = fs.readFileSync(mapPath);
      fs.writeFileSync(mapPath, JSON.stringify(nextMap, null, 2), 'utf8');
      const applied = readApplicationMapSnapshot(rootPath);
      if (!applied || applied.ok !== true || !applied.found || !applied.contentDigest
        || !validateMapGraph(applied.map)) {
        throw new Error('application map verification failed');
      }
      return { ok: true, contentDigest: applied.contentDigest };
    } catch {
      try {
        if (mapPath && hadPreviousFile) {
          fs.writeFileSync(mapPath, previousBytes);
        } else if (mapPath && fs.existsSync(mapPath)) {
          fs.unlinkSync(mapPath);
        }
      } catch {}
      return { ok: false, code: APPLICATION_MAP_PROPOSAL_REASONS.WRITE_FAILED };
    }
  }

  function upsertNode(rootPath, node) {
    if (!node || !node.id) {
      return { ok: false, message: 'Node must have an id' };
    }
    const map = getMap(rootPath);
    const index = map.nodes.findIndex((n) => n.id === node.id);
    const timestamp = new Date().toISOString();
    const nodeWithTime = {
      ...node,
      updatedAt: timestamp,
      createdAt: index >= 0 ? map.nodes[index].createdAt || timestamp : timestamp,
    };
    if (index >= 0) {
      map.nodes[index] = nodeWithTime;
    } else {
      map.nodes.push(nodeWithTime);
    }
    saveMap(rootPath, map);
    return { ok: true, node: nodeWithTime };
  }

  function removeNode(rootPath, nodeId) {
    if (!nodeId) return { ok: false, message: 'nodeId is required' };
    const map = getMap(rootPath);
    map.nodes = map.nodes.filter((n) => n.id !== nodeId);
    map.edges = map.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId);
    saveMap(rootPath, map);
    return { ok: true };
  }

  function upsertEdge(rootPath, edge) {
    if (!edge || !edge.id) {
      return { ok: false, message: 'Edge must have an id' };
    }
    const map = getMap(rootPath);
    const index = map.edges.findIndex((e) => e.id === edge.id);
    const timestamp = new Date().toISOString();
    const edgeWithTime = {
      ...edge,
      updatedAt: timestamp,
      createdAt: index >= 0 ? map.edges[index].createdAt || timestamp : timestamp,
    };
    if (index >= 0) {
      map.edges[index] = edgeWithTime;
    } else {
      map.edges.push(edgeWithTime);
    }
    saveMap(rootPath, map);
    return { ok: true, edge: edgeWithTime };
  }

  function removeEdge(rootPath, edgeId) {
    if (!edgeId) return { ok: false, message: 'edgeId is required' };
    const map = getMap(rootPath);
    map.edges = map.edges.filter((e) => e.id !== edgeId);
    saveMap(rootPath, map);
    return { ok: true };
  }

  function importAsset(rootPath, sourcePath, kind = 'other') {
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, message: 'Source file does not exist' };
    }
    try {
      const filename = path.basename(sourcePath);
      // Clean kind to avoid dir traversal
      const safeKind = String(kind || 'other').replace(/[^a-zA-Z0-9_-]/g, '');
      const relativeDestDir = path.join('Map assets', safeKind);
      const destDir = path.join(rootPath, relativeDestDir);
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      const destPath = path.join(destDir, filename);
      fs.copyFileSync(sourcePath, destPath);
      
      const relativeFilePath = path.join(relativeDestDir, filename);
      
      // Save asset in .faber/map-assets-index.json for integrity check
      const assetsIndexFile = path.join(ensureFaberDir(rootPath), 'map-assets-index.json');
      let index = [];
      if (fs.existsSync(assetsIndexFile)) {
        try {
          index = JSON.parse(fs.readFileSync(assetsIndexFile, 'utf8'));
        } catch {}
      }
      const assetRecord = {
        id: 'asset-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        originalName: filename,
        projectRelativePath: relativeFilePath.replace(/\\/g, '/'), // normalization for multiplatform
        kind: safeKind,
        importedAt: new Date().toISOString(),
      };
      index.push(assetRecord);
      fs.writeFileSync(assetsIndexFile, JSON.stringify(index, null, 2), 'utf8');
      
      return { ok: true, asset: assetRecord };
    } catch (e) {
      console.error('Failed to import asset', e);
      return { ok: false, message: e.message || String(e) };
    }
  }

  function importAssetBase64(rootPath, base64Data, fileName, kind = 'other') {
    try {
      const filename = path.basename(fileName);
      const safeKind = String(kind || 'other').replace(/[^a-zA-Z0-9_-]/g, '');
      const relativeDestDir = path.join('Map assets', safeKind);
      const destDir = path.join(rootPath, relativeDestDir);
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      const destPath = path.join(destDir, filename);
      const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(destPath, Buffer.from(base64Clean, 'base64'));
      
      const relativeFilePath = path.join(relativeDestDir, filename);
      
      const assetsIndexFile = path.join(ensureFaberDir(rootPath), 'map-assets-index.json');
      let index = [];
      if (fs.existsSync(assetsIndexFile)) {
        try {
          index = JSON.parse(fs.readFileSync(assetsIndexFile, 'utf8'));
        } catch {}
      }
      const assetRecord = {
        id: 'asset-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        originalName: filename,
        projectRelativePath: relativeFilePath.replace(/\\/g, '/'),
        kind: safeKind,
        importedAt: new Date().toISOString(),
      };
      index.push(assetRecord);
      fs.writeFileSync(assetsIndexFile, JSON.stringify(index, null, 2), 'utf8');
      
      return { ok: true, asset: assetRecord };
    } catch (e) {
      console.error('Failed to import base64 asset', e);
      return { ok: false, message: e.message || String(e) };
    }
  }

  return {
    applyApprovedProposal,
    getMap,
    readApplicationMapSnapshot,
    saveMap,
    upsertNode,
    removeNode,
    upsertEdge,
    removeEdge,
    importAsset,
    importAssetBase64,
  };
}

module.exports = {
  APPLICATION_MAP_PATCH_SCHEMA_VERSION,
  APPLICATION_MAP_PROPOSAL_REASONS,
  createApplicationMapService,
};
