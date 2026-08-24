const assert = require('assert');

const { registerApplicationMapHandlers } = require('../main/ipc/application_map_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

function createFixture() {
  const calls = [];
  const audits = [];
  const renderResults = [];
  const { handlers, registerIpcHandler } = createHandlerMap();

  const mapService = {
    getMap: (rootPath) => {
      calls.push(['getMap', rootPath]);
      return {
        nodes: [{ id: 'node-1' }],
        edges: [{ id: 'edge-1' }],
        updatedAt: '2026-08-10T12:00:00.000Z',
      };
    },
    saveMap: (rootPath, map) => {
      calls.push(['saveMap', rootPath, map]);
      return { ok: true, map };
    },
    upsertNode: (rootPath, node) => {
      calls.push(['upsertNode', rootPath, node]);
      return { ok: true, node };
    },
    removeNode: (rootPath, nodeId) => {
      calls.push(['removeNode', rootPath, nodeId]);
      return { ok: true, nodeId };
    },
    upsertEdge: (rootPath, edge) => {
      calls.push(['upsertEdge', rootPath, edge]);
      return { ok: true, edge };
    },
    removeEdge: (rootPath, edgeId) => {
      calls.push(['removeEdge', rootPath, edgeId]);
      return { ok: true, edgeId };
    },
    importAssetBase64: (rootPath, base64Data, fileName, kind) => {
      calls.push(['importAssetBase64', rootPath, base64Data, fileName, kind]);
      return { ok: true, path: `Map assets/${kind}/${fileName}` };
    },
    importAsset: (rootPath, sourcePath, kind) => {
      calls.push(['importAsset', rootPath, sourcePath, kind]);
      return { ok: true, path: `Map assets/${kind}/imported.png` };
    },
  };

  const renderService = {
    renderMap: (rootPath) => {
      calls.push(['renderMap', rootPath]);
      return renderResults.shift() || { ok: true };
    },
  };

  const renderPlanService = {
    buildRenderPlan: (payload) => {
      calls.push(['buildRenderPlan', payload]);
      return {
        ok: true,
        ready: true,
        checks: [],
        missing: [],
        milestones: [{ id: 'render-milestone-1' }],
      };
    },
  };

  registerApplicationMapHandlers({
    authorizeProjectRoot: (rootPath) => {
      calls.push(['authorizeProjectRoot', rootPath]);
      if (rootPath !== '/allowed') {
        return { ok: false, message: 'Projeto não autorizado.' };
      }
      return { ok: true, rootPath: '/authorized/project' };
    },
    mapService,
    renderService,
    renderPlanService,
    registerIpcHandler,
    appendAuditEvent: (type, payload) => audits.push({ type, payload }),
  });

  return { audits, calls, handlers, renderResults };
}

function lastServiceCall(calls) {
  return calls.filter(([name]) => name !== 'authorizeProjectRoot').at(-1);
}

function run() {
  const fixture = createFixture();
  const { audits, calls, handlers, renderResults } = fixture;

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'application-map:asset:import',
    'application-map:edge:remove',
    'application-map:edge:upsert',
    'application-map:get',
    'application-map:node:remove',
    'application-map:node:upsert',
    'application-map:render',
    'application-map:render-plan',
    'application-map:save',
    'application-map:summary',
  ]);

  const getResult = handlers['application-map:get'](null, { rootPath: '/allowed' });
  assert.strictEqual(getResult.ok, true);
  assert.strictEqual(getResult.map.nodes[0].id, 'node-1');
  assert.deepStrictEqual(lastServiceCall(calls), ['getMap', '/authorized/project']);

  const map = { nodes: [{ id: 'node-2' }], edges: [] };
  assert.strictEqual(handlers['application-map:save'](null, { rootPath: '/allowed', map }).ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), ['saveMap', '/authorized/project', map]);

  const node = { id: 'node-2', title: 'Checkout' };
  handlers['application-map:node:upsert'](null, { rootPath: '/allowed', node });
  assert.deepStrictEqual(lastServiceCall(calls), ['upsertNode', '/authorized/project', node]);

  handlers['application-map:node:remove'](null, { rootPath: '/allowed', nodeId: 'node-2' });
  assert.deepStrictEqual(lastServiceCall(calls), ['removeNode', '/authorized/project', 'node-2']);

  const edge = { id: 'edge-2', source: 'node-1', target: 'node-2' };
  handlers['application-map:edge:upsert'](null, { rootPath: '/allowed', edge });
  assert.deepStrictEqual(lastServiceCall(calls), ['upsertEdge', '/authorized/project', edge]);

  handlers['application-map:edge:remove'](null, { rootPath: '/allowed', edgeId: 'edge-2' });
  assert.deepStrictEqual(lastServiceCall(calls), ['removeEdge', '/authorized/project', 'edge-2']);

  const base64Result = handlers['application-map:asset:import'](null, {
    rootPath: '/allowed',
    base64Data: 'aW1hZ2U=',
    fileName: 'hero.png',
    kind: 'image',
    sourcePath: '/must/not/be/used.png',
  });
  assert.strictEqual(base64Result.ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), [
    'importAssetBase64',
    '/authorized/project',
    'aW1hZ2U=',
    'hero.png',
    'image',
  ]);

  const fileResult = handlers['application-map:asset:import'](null, {
    rootPath: '/allowed',
    sourcePath: '/source/logo.svg',
    kind: 'logo',
  });
  assert.strictEqual(fileResult.ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), [
    'importAsset',
    '/authorized/project',
    '/source/logo.svg',
    'logo',
  ]);

  const summary = handlers['application-map:summary'](null, { rootPath: '/allowed' });
  assert.deepStrictEqual(summary, {
    ok: true,
    summary: {
      totalNodes: 1,
      totalEdges: 1,
      updatedAt: '2026-08-10T12:00:00.000Z',
    },
  });

  renderResults.push({ ok: true, outputDir: '/authorized/project/docs/application-map' });
  const successfulRender = handlers['application-map:render'](null, { rootPath: '/allowed' });
  assert.strictEqual(successfulRender.ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), ['renderMap', '/authorized/project']);
  assert.deepStrictEqual(audits, [{
    type: 'application_map.rendered',
    payload: { rootPath: '/authorized/project' },
  }]);

  renderResults.push({ ok: false, message: 'render failed' });
  const failedRender = handlers['application-map:render'](null, { rootPath: '/allowed' });
  assert.deepStrictEqual(failedRender, { ok: false, message: 'render failed' });
  assert.strictEqual(audits.length, 1);

  const renderPlanPayload = {
    rootPath: '/allowed',
    mapData: { nodes: [{ id: 'node-1' }], edges: [] },
    combinedText: 'Tradeoffs, security e design system.',
    documents: [{ path: 'docs/application-map/README.md', content: 'Contexto' }],
    previousMilestones: [{ id: 'previous-1' }],
    requestText: 'Refinar o plano',
    copy: { renderFoundationTitle: 'Foundation' },
  };
  const renderPlanResult = handlers['application-map:render-plan'](null, renderPlanPayload);
  assert.strictEqual(renderPlanResult.ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), [
    'buildRenderPlan',
    {
      mapData: renderPlanPayload.mapData,
      combinedText: renderPlanPayload.combinedText,
      documents: renderPlanPayload.documents,
      previousMilestones: renderPlanPayload.previousMilestones,
      requestText: renderPlanPayload.requestText,
      copy: renderPlanPayload.copy,
    },
  ]);

  const deniedCases = [
    ['application-map:get', {}],
    ['application-map:save', { map }],
    ['application-map:node:upsert', { node }],
    ['application-map:node:remove', { nodeId: 'node-2' }],
    ['application-map:edge:upsert', { edge }],
    ['application-map:edge:remove', { edgeId: 'edge-2' }],
    ['application-map:asset:import', { sourcePath: '/source/logo.svg' }],
    ['application-map:render', {}],
    ['application-map:render-plan', {}],
    ['application-map:summary', {}],
  ];

  for (const [channel, payload] of deniedCases) {
    const serviceCallsBefore = calls.filter(([name]) => name !== 'authorizeProjectRoot').length;
    const result = handlers[channel](null, { ...payload, rootPath: '/denied' });
    assert.deepStrictEqual(result, { ok: false, message: 'Projeto não autorizado.' });
    assert.strictEqual(
      calls.filter(([name]) => name !== 'authorizeProjectRoot').length,
      serviceCallsBefore,
      `${channel} must not call a service after authorization fails`
    );
  }

  const missingRoot = handlers['application-map:get'](null);
  assert.deepStrictEqual(missingRoot, { ok: false, message: 'Projeto não autorizado.' });
  assert.deepStrictEqual(calls.at(-1), ['authorizeProjectRoot', '']);

  console.log('application-map-handlers.test.js: ok');
}

run();
