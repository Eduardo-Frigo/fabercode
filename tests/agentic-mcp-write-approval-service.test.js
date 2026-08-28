'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  AGENTIC_MCP_WRITE_APPROVAL_SERVICE_VERSION,
  FIXED_MCP_WRITE_APPROVAL_DIALOG,
  MCP_WRITE_APPROVAL_REASONS,
  createAgenticMcpWriteApprovalService,
} = require('../main/services/agentic_mcp_write_approval_service');

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

const binding = Object.freeze({
  projectId: 'project-mcp-write',
  canonicalRootPath: '/projects/mcp-write',
  realRootPath: '/private/projects/mcp-write',
  sessionId: 'session-mcp-write',
  jobId: 'job-mcp-write',
  kernelId: 'kernel-mcp-write',
  submissionDigest: sha256('mcp-write-submission'),
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createHarness({ dialog = null } = {}) {
  const state = {
    active: true,
    dialogCalls: 0,
    dialogPayloads: [],
    lease: Object.freeze({ window: 'main' }),
    now: 1_000,
    signal: null,
  };
  const service = createAgenticMcpWriteApprovalService({
    showNativeDialog(payload, context) {
      state.dialogCalls += 1;
      state.dialogPayloads.push({ payload, context });
      return dialog ? dialog(payload, context) : Promise.resolve({ response: 1 });
    },
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
    authorizeWriteFrontier(input) {
      return state.active && input.windowLease === state.lease
        ? Object.freeze({
          authorized: true,
          binding: input.binding,
          windowLease: input.windowLease,
          serverId: input.serverId,
          toolName: input.toolName,
          invocationDigest: input.invocationDigest,
        })
        : Object.freeze({ authorized: false });
    },
    getWindowLease() {
      return state.lease;
    },
    getSignal() {
      return state.signal;
    },
    now() {
      return state.now;
    },
  });
  return { service, state };
}

function approvalInput(harness, overrides = {}) {
  return Object.freeze({
    binding,
    windowLease: harness.state.lease,
    serverId: 'publisher-approved',
    toolName: 'publish_docs',
    invocationDigest: sha256('exact-server-tool-arguments-and-policy'),
    idempotencyKey: 'publish-docs-1',
    riskLevel: 'high',
    projectLabel: 'Faber Project',
    ...overrides,
  });
}

async function testApprovalIsFreshDigestBoundAndOneShot() {
  const harness = createHarness();
  assert.strictEqual(
    harness.service.diagnostics().version,
    AGENTIC_MCP_WRITE_APPROVAL_SERVICE_VERSION
  );
  assert.strictEqual(FIXED_MCP_WRITE_APPROVAL_DIALOG.defaultId, 0);
  assert.strictEqual(FIXED_MCP_WRITE_APPROVAL_DIALOG.cancelId, 0);
  assert.deepStrictEqual(
    FIXED_MCP_WRITE_APPROVAL_DIALOG.buttons,
    ['Cancelar', 'Permitir esta chamada']
  );

  const input = approvalInput(harness);
  const approval = await harness.service.requestApproval(input);
  assert.strictEqual(approval.ok, true);
  assert.strictEqual(approval.approved, true);
  assert.strictEqual(approval.reason, MCP_WRITE_APPROVAL_REASONS.APPROVED);
  assert.strictEqual(typeof approval.receipt, 'object');
  assert.strictEqual(Object.isFrozen(approval.receipt), true);
  assert.strictEqual(harness.state.dialogCalls, 1);
  const dialog = harness.state.dialogPayloads[0];
  assert.strictEqual(Object.isFrozen(dialog.payload), true);
  assert.strictEqual(Object.isFrozen(dialog.payload.buttons), true);
  assert.strictEqual(dialog.context.signal instanceof AbortSignal, true);
  assert.match(dialog.payload.detail, /Projeto: Faber Project/);
  assert.match(dialog.payload.detail, /Servidor: publisher-approved/);
  assert.match(dialog.payload.detail, /Ferramenta: publish_docs/);
  assert.match(dialog.payload.detail, /Risco declarado: high/);
  assert.strictEqual(dialog.payload.detail.includes('/private/projects'), false);
  assert.strictEqual(dialog.payload.detail.includes('arguments'), false);

  const consumed = harness.service.consumeApproval(Object.freeze({
    ...input,
    receipt: approval.receipt,
  }));
  assert.deepStrictEqual(consumed, {
    ok: true,
    authorized: true,
    reason: MCP_WRITE_APPROVAL_REASONS.CONSUMED,
  });
  const replay = harness.service.consumeApproval(Object.freeze({
    ...input,
    receipt: approval.receipt,
  }));
  assert.deepStrictEqual(replay, {
    ok: false,
    authorized: false,
    reason: MCP_WRITE_APPROVAL_REASONS.REPLAYED,
  });
}

async function testMismatchedDigestCannotConsumeApproval() {
  const harness = createHarness();
  const input = approvalInput(harness);
  const approval = await harness.service.requestApproval(input);
  const mismatch = harness.service.consumeApproval(Object.freeze({
    ...input,
    invocationDigest: sha256('different-request'),
    receipt: approval.receipt,
  }));
  assert.deepStrictEqual(mismatch, {
    ok: false,
    authorized: false,
    reason: MCP_WRITE_APPROVAL_REASONS.MISMATCH,
  });
  const exact = harness.service.consumeApproval(Object.freeze({
    ...input,
    receipt: approval.receipt,
  }));
  assert.strictEqual(exact.authorized, true);
}

async function testNativeDenialAndCancellationNeverIssueAReceipt() {
  const deniedHarness = createHarness({
    dialog: () => Promise.resolve({ response: 0 }),
  });
  const denied = await deniedHarness.service.requestApproval(approvalInput(deniedHarness));
  assert.deepStrictEqual(denied, {
    ok: true,
    approved: false,
    reason: MCP_WRITE_APPROVAL_REASONS.DENIED,
  });

  const pendingDialog = deferred();
  const cancelledHarness = createHarness({
    dialog: () => pendingDialog.promise,
  });
  const controller = new AbortController();
  cancelledHarness.state.signal = controller.signal;
  const pending = cancelledHarness.service.requestApproval(approvalInput(cancelledHarness));
  controller.abort();
  pendingDialog.resolve({ response: 1 });
  const cancelled = await pending;
  assert.deepStrictEqual(cancelled, {
    ok: false,
    approved: false,
    reason: MCP_WRITE_APPROVAL_REASONS.CANCELED,
  });
  assert.strictEqual(cancelledHarness.service.diagnostics().activeApprovals, 0);
}

async function testRevocationAndExpiryInvalidateFreshApproval() {
  const harness = createHarness();
  const input = approvalInput(harness);
  const approval = await harness.service.requestApproval(input);
  harness.state.active = false;
  const revoked = harness.service.consumeApproval(Object.freeze({
    ...input,
    receipt: approval.receipt,
  }));
  assert.strictEqual(revoked.authorized, false);
  assert.strictEqual(revoked.reason, MCP_WRITE_APPROVAL_REASONS.REVOKED);

  const expiryHarness = createHarness();
  const expiryInput = approvalInput(expiryHarness);
  const expiringApproval = await expiryHarness.service.requestApproval(expiryInput);
  expiryHarness.state.now += 60_000;
  const expired = expiryHarness.service.consumeApproval(Object.freeze({
    ...expiryInput,
    receipt: expiringApproval.receipt,
  }));
  assert.strictEqual(expired.authorized, false);
  assert.strictEqual(expired.reason, MCP_WRITE_APPROVAL_REASONS.EXPIRED);
}

async function main() {
  await testApprovalIsFreshDigestBoundAndOneShot();
  await testMismatchedDigestCannotConsumeApproval();
  await testNativeDenialAndCancellationNeverIssueAReceipt();
  await testRevocationAndExpiryInvalidateFreshApproval();
  console.log('agentic-mcp-write-approval-service.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
