'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createAgenticBrowserBrokerFactory,
} = require('../main/services/agentic_browser_broker_factory');
const {
  createAgenticBrowserSessionService,
} = require('../main/services/agentic_browser_session_service');

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

const binding = createCapabilityDelegationBinding({
  projectId: 'project-browser',
  canonicalRootPath: '/projects/browser',
  realRootPath: '/private/projects/browser',
  sessionId: 'project-session-browser',
  jobId: 'job-browser',
  kernelId: 'kernel-browser',
  submissionDigest: sha256('browser-submission'),
});

function createFakeBrowserWindowClass(state) {
  return class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.url = '';
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.session = {
        webRequest: { onErrorOccurred() {} },
      };
      this.webContents.capturePage = async () => ({
        toPNG: () => Buffer.from('broker-png'),
      });
      this.webContents.executeJavaScript = async (script) => {
        state.executedScripts.push(script);
        return { ok: true, tagName: 'button' };
      };
      this.webContents.getURL = () => this.url;
      this.webContents.getTitle = () => 'Broker preview';
      state.windows.push(this);
    }

    async loadURL(url) {
      this.url = url;
      state.loadedUrls.push(url);
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  };
}

function createPendingApprovalStore() {
  let sequence = 0;
  const records = new Map();
  return Object.freeze({
    async create(input) {
      const approval = Object.freeze({
        approvalId: `browser-approval-${++sequence}`,
        ...input,
        status: 'pending',
        expiresAt: Date.now() + 120000,
      });
      records.set(approval.approvalId, approval);
      return { ok: true, approval };
    },
    async resolve(input) {
      const approval = records.get(input.approvalId);
      if (!approval || approval.requestDigest !== input.requestDigest) {
        return { ok: false, resolved: false };
      }
      return {
        ok: true,
        resolved: true,
        decision: input.decision,
        approval,
      };
    },
  });
}

function createHarness() {
  const state = {
    active: true,
    allowExternal: false,
    audits: [],
    grantInspections: 0,
    grantConsumptions: 0,
    executedScripts: [],
    loadedUrls: [],
    requestIds: 0,
    signal: null,
    windows: [],
  };
  const BrowserWindow = createFakeBrowserWindowClass(state);
  const browserSessionService = createAgenticBrowserSessionService({
    BrowserWindow,
    authorizeNavigation: async ({ url }) => {
      const parsed = new URL(url);
      const local = parsed.protocol === 'file:'
        || ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
      return { allowed: local || (state.allowExternal && parsed.origin === 'https://allowed.example') };
    },
  });
  const grantStore = Object.freeze({
    async inspect(input) {
      state.grantInspections += 1;
      const allowed = state.allowExternal
        && input.selector
        && input.selector.origin === 'https://allowed.example';
      return allowed
        ? { authorized: true, reason: 'domain_allowlisted', grant: { grantId: 'browser-domain-grant' } }
        : { authorized: false, reason: 'grant_not_found' };
    },
    async consume(input) {
      state.grantConsumptions += 1;
      return input.grantId === 'browser-domain-grant' && state.allowExternal
        ? { authorized: true, reason: 'domain_allowlisted', grant: { grantId: input.grantId } }
        : { authorized: false, reason: 'grant_not_found' };
    },
  });
  const factory = createAgenticBrowserBrokerFactory({
    authorizeLifecycle(candidate) {
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    authorizeRoot(input) {
      return state.active
        ? Object.freeze({
          ok: true,
          authorized: true,
          projectId: input.projectId,
          rootPath: input.rootPath,
          canonicalRootPath: input.rootPath,
          realRootPath: binding.realRootPath,
        })
        : Object.freeze({ authorized: false });
    },
    authorizeEffectFrontier(candidate) {
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    browserSessionService,
    grantStore,
    pendingApprovalStore: createPendingApprovalStore(),
    approvalReviewer: Object.freeze({
      async verifyDecision(input) {
        return input.proof === 'valid-proof'
          ? { verified: true, decision: input.decision }
          : { verified: false };
      },
    }),
    audit(event) {
      state.audits.push(event);
    },
    requestIdFactory() {
      state.requestIds += 1;
      return `browser-request-${state.requestIds}`;
    },
    getSignal() {
      return state.signal;
    },
  });
  const route = factory.createRoute(Object.freeze({ binding }));
  return { browserSessionService, factory, route, state };
}

async function testLocalNavigationAndVisualCaptureStayJobBound() {
  const harness = createHarness();
  const opened = await harness.route.open(Object.freeze({
    url: 'file:///projects/browser/index.html',
    viewport: Object.freeze({ width: 1280, height: 720 }),
  }));
  assert.strictEqual(opened.status, 'completed');
  assert.strictEqual(opened.output.ok, true);
  assert.strictEqual(opened.output.session.url, 'file:///projects/browser/index.html');
  assert.strictEqual(harness.state.windows.length, 1);
  assert.strictEqual(harness.state.grantInspections, 1);
  assert.strictEqual(harness.state.grantConsumptions, 0);

  const sessionId = opened.output.session.id;
  const capture = await harness.route.capture(Object.freeze({ sessionId }));
  assert.strictEqual(capture.ok, true);
  assert.strictEqual(capture.image.type, 'image');
  assert.strictEqual(capture.image.mimeType, 'image/png');
  assert.strictEqual(capture.image.data, Buffer.from('broker-png').toString('base64'));

  const inspected = harness.route.inspect(Object.freeze({ sessionId }));
  assert.strictEqual(inspected.ok, true);
  assert.strictEqual(inspected.session.id, sessionId);
  const closed = harness.route.close(Object.freeze({ sessionId }));
  assert.strictEqual(closed.ok, true);
  assert.strictEqual(harness.state.windows[0].destroyed, true);
}

async function testExternalNavigationRequiresDomainGrantBeforeBrowserEffect() {
  const harness = createHarness();
  const pending = await harness.route.open(Object.freeze({
    url: 'https://allowed.example/dashboard',
    viewport: Object.freeze({ width: 1365, height: 768 }),
  }));
  assert.strictEqual(pending.status, 'approval_required');
  assert.strictEqual(pending.decision, 'require_approval');
  assert.strictEqual(harness.state.windows.length, 0);
  assert.deepStrictEqual(harness.state.loadedUrls, []);

  harness.state.allowExternal = true;
  const allowed = await harness.route.open(Object.freeze({
    url: 'https://allowed.example/dashboard',
    viewport: Object.freeze({ width: 1365, height: 768 }),
  }));
  assert.strictEqual(allowed.status, 'completed');
  assert.strictEqual(allowed.output.ok, true);
  assert.strictEqual(harness.state.windows.length, 1);
  assert.strictEqual(harness.state.grantConsumptions, 1);
  assert.deepStrictEqual(harness.state.loadedUrls, ['https://allowed.example/dashboard']);
}

async function testRevocationBlocksFurtherNavigation() {
  const harness = createHarness();
  const opened = await harness.route.open(Object.freeze({
    url: 'http://127.0.0.1:3000/',
    viewport: Object.freeze({ width: 1024, height: 768 }),
  }));
  assert.strictEqual(opened.status, 'completed');
  const sessionId = opened.output.session.id;
  harness.state.active = false;

  const denied = await harness.route.navigate(Object.freeze({
    sessionId,
    url: 'http://127.0.0.1:3000/settings',
  }));
  assert.strictEqual(denied.status, 'denied');
  assert.strictEqual(denied.error.code, 'PROJECT_SCOPE_INVALID');
  assert.deepStrictEqual(harness.state.loadedUrls, ['http://127.0.0.1:3000/']);

  const captureDenied = await harness.route.capture(Object.freeze({ sessionId }));
  assert.deepStrictEqual(captureDenied, {
    ok: false,
    code: 'AGENTIC_BROWSER_ROUTE_AUTHORITY_DENIED',
  });
}

async function testLocalInteractionIsIdempotentAndExternalInteractionStaysDenied() {
  const harness = createHarness();
  const opened = await harness.route.open(Object.freeze({
    url: 'http://127.0.0.1:3000/',
    viewport: Object.freeze({ width: 1024, height: 768 }),
  }));
  const sessionId = opened.output.session.id;
  const interaction = Object.freeze({
    sessionId,
    action: 'click',
    selector: '[data-testid="save"]',
    idempotencyKey: 'browser-interaction-save-1',
  });
  const first = await harness.route.interact(interaction);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.action, 'click');
  assert.strictEqual(harness.state.executedScripts.length, 1);

  const replay = await harness.route.interact(interaction);
  assert.deepStrictEqual(replay, first);
  assert.strictEqual(harness.state.executedScripts.length, 1);

  const conflict = await harness.route.interact(Object.freeze({
    sessionId,
    action: 'fill',
    selector: '#name',
    value: 'Eduardo',
    idempotencyKey: 'browser-interaction-save-1',
  }));
  assert.deepStrictEqual(conflict, {
    ok: false,
    code: 'AGENTIC_BROWSER_ROUTE_IDEMPOTENCY_CONFLICT',
  });
  assert.strictEqual(harness.state.executedScripts.length, 1);

  harness.state.allowExternal = true;
  const external = await harness.route.open(Object.freeze({
    url: 'https://allowed.example/dashboard',
    viewport: Object.freeze({ width: 1024, height: 768 }),
  }));
  assert.strictEqual(external.status, 'completed');
  const denied = await harness.route.interact(Object.freeze({
    sessionId: external.output.session.id,
    action: 'click',
    selector: '#publish',
    idempotencyKey: 'external-publish-1',
  }));
  assert.deepStrictEqual(denied, {
    ok: false,
    code: 'AGENTIC_BROWSER_ROUTE_INTERACTION_DENIED',
  });
  assert.strictEqual(harness.state.executedScripts.length, 1);
}

async function testCancelledInteractionClosesTheLocalSession() {
  const harness = createHarness();
  const opened = await harness.route.open(Object.freeze({
    url: 'http://127.0.0.1:3000/',
    viewport: Object.freeze({ width: 1024, height: 768 }),
  }));
  const controller = new AbortController();
  controller.abort();
  harness.state.signal = controller.signal;

  const cancelled = await harness.route.interact(Object.freeze({
    sessionId: opened.output.session.id,
    action: 'click',
    selector: '#cancelled-action',
    idempotencyKey: 'cancelled-browser-interaction-1',
  }));
  assert.deepStrictEqual(cancelled, {
    ok: false,
    cancelled: true,
    code: 'AGENTIC_BROWSER_SESSION_CANCELLED',
  });
  assert.strictEqual(harness.state.executedScripts.length, 0);
  assert.strictEqual(harness.state.windows[0].destroyed, true);
}

async function main() {
  await testLocalNavigationAndVisualCaptureStayJobBound();
  await testExternalNavigationRequiresDomainGrantBeforeBrowserEffect();
  await testRevocationBlocksFurtherNavigation();
  await testLocalInteractionIsIdempotentAndExternalInteractionStaysDenied();
  await testCancelledInteractionClosesTheLocalSession();
  console.log('agentic-browser-broker-factory.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
