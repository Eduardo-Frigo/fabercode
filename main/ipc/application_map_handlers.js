function registerApplicationMapHandlers(dependencies = {}) {
  const {
    authorizeProjectRoot,
    mapService,
    renderService,
    registerIpcHandler,
    appendAuditEvent = () => {},
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Application Map IPC dependency missing: ${name}`);
  }

  requireDependency('authorizeProjectRoot', authorizeProjectRoot);
  requireDependency('mapService', mapService);
  requireDependency('renderService', renderService);
  requireDependency('registerIpcHandler', registerIpcHandler);

  registerIpcHandler('application-map:get', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return { ok: true, map: mapService.getMap(auth.rootPath) };
  });

  registerIpcHandler('application-map:save', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return mapService.saveMap(auth.rootPath, payload.map || {});
  });

  registerIpcHandler('application-map:node:upsert', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return mapService.upsertNode(auth.rootPath, payload.node || {});
  });

  registerIpcHandler('application-map:node:remove', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return mapService.removeNode(auth.rootPath, payload.nodeId || '');
  });

  registerIpcHandler('application-map:edge:upsert', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return mapService.upsertEdge(auth.rootPath, payload.edge || {});
  });

  registerIpcHandler('application-map:edge:remove', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return mapService.removeEdge(auth.rootPath, payload.edgeId || '');
  });

  registerIpcHandler('application-map:asset:import', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    if (payload.base64Data && payload.fileName) {
      return mapService.importAssetBase64(auth.rootPath, payload.base64Data, payload.fileName, payload.kind || 'other');
    }
    return mapService.importAsset(auth.rootPath, payload.sourcePath || '', payload.kind || 'other');
  });

  registerIpcHandler('application-map:render', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    
    const result = renderService.renderMap(auth.rootPath);
    if (result.ok) {
      appendAuditEvent('application_map.rendered', {
        rootPath: auth.rootPath,
      });
    }
    return result;
  });

  registerIpcHandler('application-map:summary', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    
    const map = mapService.getMap(auth.rootPath);
    return {
      ok: true,
      summary: {
        totalNodes: map.nodes ? map.nodes.length : 0,
        totalEdges: map.edges ? map.edges.length : 0,
        updatedAt: map.updatedAt,
      }
    };
  });
}

module.exports = {
  registerApplicationMapHandlers,
};
