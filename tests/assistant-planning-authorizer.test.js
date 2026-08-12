'use strict';

const assert = require('assert');

const {
  createAssistantPlanningAuthorizer,
} = require('../main/agent_runtime/assistant_planning_authorizer');

function createHarness() {
  const calls = [];
  const binding = {
    ok: true,
    authorized: true,
    projectId: 'project-1',
    canonicalRootPath: '/workspace/project',
    rootPath: '/workspace/project',
    realRootPath: '/real/workspace/project',
    physicalRootIdentity: { device: '1', inode: '2' },
  };
  const authorizer = createAssistantPlanningAuthorizer({
    authorizeProjectBinding(projectId, rootPath) {
      calls.push(['strong', projectId, rootPath]);
      return projectId === 'project-1' && rootPath === '/workspace/project'
        ? binding
        : { ok: false, authorized: false };
    },
    authorizeProjectRootBinding(rootPath) {
      calls.push(['root', rootPath]);
      return rootPath === '/workspace/project' ? binding : { ok: false, authorized: false };
    },
    normalizeProjectInfo(projectInfo, options) {
      calls.push(['normalize', projectInfo, options]);
      if (!options || options.requireProjectBinding !== true) return { ok: false };
      return {
        ok: true,
        projectInfo: {
          ...projectInfo,
          canonicalRootPath: binding.canonicalRootPath,
          realRootPath: binding.realRootPath,
          authorized: true,
          scanned: true,
        },
      };
    },
  });
  return { authorizer, calls };
}

function request(projectInfo = { rootPath: '/workspace/project' }) {
  return {
    operation: 'plan',
    payload: {
      projectInfo,
      userMessage: 'Construa o app',
      attachments: [],
      approvalMode: 'ask_each',
      contextHint: {
        safe: 'visible',
        personaApprovedExecution: true,
        personaRouteDecision: { decision: 'execute' },
        nested: { jobId: 'job-forged', productRouteDecision: { decision: 'execute' } },
      },
      jobId: 'job-forged',
    },
  };
}

function run() {
  const rootOnly = createHarness();
  const resolved = rootOnly.authorizer.authorize(request());
  assert.strictEqual(resolved.ok, true);
  assert.deepStrictEqual(rootOnly.calls[0], ['root', '/workspace/project']);
  assert.strictEqual(rootOnly.calls[1][0], 'normalize');
  assert.deepStrictEqual(rootOnly.calls[1][2], { requireProjectBinding: true });
  assert.strictEqual(resolved.payload.projectInfo.id, 'project-1');
  assert.strictEqual(resolved.payload.projectInfo.projectId, 'project-1');
  assert.strictEqual(resolved.payload.projectInfo.rootPath, '/workspace/project');
  assert.strictEqual(resolved.payload.projectInfo.scanned, true);
  assert.strictEqual(Object.hasOwn(resolved.payload, 'jobId'), false);
  assert.deepStrictEqual(resolved.payload.contextHint, { safe: 'visible', nested: {} });
  assert.strictEqual(resolved.payload.approvalMode, 'ask_each');
  assert.strictEqual(Object.isFrozen(resolved.payload), true);
  assert.strictEqual(Object.isFrozen(resolved.payload.projectInfo), true);
  assert.strictEqual(Object.isFrozen(resolved.payload.contextHint), true);

  const identified = createHarness();
  assert.strictEqual(identified.authorizer.authorize(request({
    id: 'project-1',
    projectId: 'project-1',
    rootPath: '/workspace/project',
    canonicalRootPath: '/forged',
    realRootPath: '/forged-real',
  })).ok, true);
  assert.deepStrictEqual(identified.calls[0], ['strong', 'project-1', '/workspace/project']);
  assert.strictEqual(identified.calls[1][1].canonicalRootPath, undefined);
  assert.strictEqual(identified.calls[1][1].realRootPath, undefined);

  const forgedId = createHarness();
  assert.strictEqual(forgedId.authorizer.authorize(request({
    id: 'project-attacker',
    rootPath: '/workspace/project',
  })).ok, false);
  assert.strictEqual(forgedId.calls.filter(([kind]) => kind === 'normalize').length, 0);

  const conflicting = createHarness();
  assert.strictEqual(conflicting.authorizer.authorize(request({
    id: 'project-1',
    projectId: 'project-2',
    rootPath: '/workspace/project',
  })).ok, false);
  assert.strictEqual(conflicting.calls.length, 0);

  const map = createHarness();
  const mapResult = map.authorizer.authorize({
    ...request(),
    operation: 'map_message',
  });
  assert.strictEqual(mapResult.ok, true);
  assert.strictEqual(mapResult.payload.projectInfo.id, 'project-1');

  const hostile = createHarness();
  const accessorProject = {};
  let getterReads = 0;
  Object.defineProperty(accessorProject, 'rootPath', {
    enumerable: true,
    get() { getterReads += 1; return '/workspace/project'; },
  });
  assert.strictEqual(hostile.authorizer.authorize(request(accessorProject)).ok, false);
  assert.strictEqual(getterReads, 0);
  const symbolPayload = request();
  symbolPayload.payload[Symbol('hostile')] = true;
  assert.strictEqual(hostile.authorizer.authorize(symbolPayload).ok, false);
  assert.strictEqual(hostile.authorizer.authorize({ ...request(), operation: 'execute' }).ok, false);

  const reentrant = createAssistantPlanningAuthorizer({
    authorizeProjectBinding: () => { throw new Error('must not run'); },
    authorizeProjectRootBinding: () => Promise.resolve(binding),
    normalizeProjectInfo: () => ({ ok: true }),
  });
  assert.strictEqual(reentrant.authorize(request()).ok, false);

  console.log('assistant-planning-authorizer.test.js: ok');
}

run();
