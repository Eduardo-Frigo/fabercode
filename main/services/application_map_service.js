const defaultFs = require('fs');
const defaultPath = require('path');

function createApplicationMapService(dependencies = {}) {
  const fs = dependencies.fs || defaultFs;
  const path = dependencies.path || defaultPath;

  function ensureFaberDir(rootPath) {
    const faberDir = path.join(rootPath, '.faber');
    if (!fs.existsSync(faberDir)) {
      fs.mkdirSync(faberDir, { recursive: true });
    }
    return faberDir;
  }

  function getMapPath(rootPath) {
    return path.join(ensureFaberDir(rootPath), 'application-map.json');
  }

  function getMap(rootPath) {
    const mapPath = getMapPath(rootPath);
    if (!fs.existsSync(mapPath)) {
      return {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: new Date().toISOString(),
      };
    }
    try {
      const content = fs.readFileSync(mapPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse application map JSON', e);
      return {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: new Date().toISOString(),
      };
    }
  }

  function saveMap(rootPath, mapData) {
    const mapPath = getMapPath(rootPath);
    const data = {
      nodes: mapData.nodes || [],
      edges: mapData.edges || [],
      viewport: mapData.viewport || { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(mapPath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, map: data };
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

  return {
    getMap,
    saveMap,
    upsertNode,
    removeNode,
    upsertEdge,
    removeEdge,
    importAsset,
  };
}

module.exports = {
  createApplicationMapService,
};
