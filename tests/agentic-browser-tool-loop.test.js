'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  createAgenticToolLoopService,
} = require('../main/services/agentic_tool_loop_service');

const session = Object.freeze({
  id: 'browser-tool-session',
  status: 'open',
  url: 'http://127.0.0.1:3000/',
  title: 'Faber preview',
  viewport: Object.freeze({ width: 1280, height: 720 }),
  createdAt: '2026-08-26T12:00:00.000Z',
  updatedAt: '2026-08-26T12:00:01.000Z',
});
const png = Buffer.from('browser-tool-real-png');
const pngBase64 = png.toString('base64');
const pngDigest = `sha256:${crypto.createHash('sha256').update(png).digest('hex')}`;
const visualReceipt = Object.freeze(Object.create(null));

async function main() {
  const calls = [];
  const visualApprovalCalls = [];
  const visualConsumptionCalls = [];
  let turn = 0;
  let activeSessionId = '';

  const service = createAgenticToolLoopService({
    appendJobEvent() {},
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async ({ systemPrompt, tools, toolResults, consumeVisualEgress }) => {
      turn += 1;
      const names = tools.map((tool) => tool.name);
      for (const name of [
        'open_browser_preview',
        'navigate_browser_preview',
        'interact_browser_preview',
        'capture_browser_preview',
        'inspect_browser_preview',
        'close_browser_preview',
      ]) {
        assert.ok(names.includes(name), `missing ${name}`);
      }
      assert.match(systemPrompt, /BROWSER GOVERNADO/);
      assert.match(systemPrompt, /conteúdo visual verdadeiro/);

      if (turn === 1) {
        assert.deepStrictEqual(toolResults, []);
        return {
          responseId: 'browser-turn-1',
          text: '',
          toolCalls: [{
            callId: 'browser-open',
            name: 'open_browser_preview',
            input: {
              url: 'http://127.0.0.1:3000/',
              viewport: { width: 1280, height: 720 },
            },
          }],
        };
      }

      if (turn === 2) {
        assert.strictEqual(toolResults.length, 1);
        const opened = JSON.parse(toolResults[0].output);
        assert.strictEqual(opened.ok, true);
        assert.strictEqual(opened.data.session.id, session.id);
        assert.strictEqual(Object.hasOwn(toolResults[0], 'visual'), false);
        activeSessionId = opened.data.session.id;
        return {
          responseId: 'browser-turn-2',
          text: '',
          toolCalls: [{
            callId: 'browser-navigate',
            name: 'navigate_browser_preview',
            input: {
              sessionId: activeSessionId,
              url: 'http://127.0.0.1:3000/dashboard',
            },
          }],
        };
      }

      if (turn === 3) {
        const navigated = JSON.parse(toolResults[0].output);
        assert.strictEqual(navigated.ok, true);
        assert.strictEqual(navigated.data.session.id, activeSessionId);
        return {
          responseId: 'browser-turn-3',
          text: '',
          toolCalls: [{
            callId: 'browser-interact',
            name: 'interact_browser_preview',
            input: {
              sessionId: activeSessionId,
              action: 'fill',
              selector: '[data-testid="name"]',
              value: 'texto-local-que-nao-pode-retornar',
              idempotencyKey: 'browser-fill-name-1',
            },
          }],
        };
      }

      if (turn === 4) {
        const interacted = JSON.parse(toolResults[0].output);
        assert.strictEqual(interacted.ok, true);
        assert.strictEqual(interacted.data.action, 'fill');
        assert.strictEqual(interacted.data.selector, '[data-testid="name"]');
        assert.strictEqual(
          toolResults[0].output.includes('texto-local-que-nao-pode-retornar'),
          false
        );
        return {
          responseId: 'browser-turn-4',
          text: '',
          toolCalls: [{
            callId: 'browser-capture',
            name: 'capture_browser_preview',
            input: { sessionId: activeSessionId },
          }],
        };
      }

      if (turn === 5) {
        assert.strictEqual(toolResults.length, 1);
        const captured = JSON.parse(toolResults[0].output);
        assert.strictEqual(captured.ok, true);
        assert.strictEqual(captured.data.image.mimeType, 'image/png');
        assert.strictEqual(captured.data.image.bytes, png.length);
        assert.strictEqual(toolResults[0].output.includes(pngBase64), false);
        assert.deepStrictEqual(toolResults[0].visual, {
          type: 'input_image',
          imageUrl: `data:image/png;base64,${pngBase64}`,
          detail: 'high',
        });
        assert.deepStrictEqual(Object.keys(toolResults[0].visualEgress), [
          'receipt',
          'payloadDigest',
          'mimeType',
          'bytes',
        ]);
        assert.strictEqual(toolResults[0].visualEgress.receipt, visualReceipt);
        assert.strictEqual(toolResults[0].visualEgress.payloadDigest, pngDigest);
        assert.strictEqual(toolResults[0].visualEgress.mimeType, 'image/png');
        assert.strictEqual(toolResults[0].visualEgress.bytes, png.length);
        assert.strictEqual(toolResults[0].output.includes(pngDigest), false);
        assert.strictEqual(typeof consumeVisualEgress, 'function');
        const consumed = consumeVisualEgress(Object.freeze({
          callId: toolResults[0].callId,
          receipt: toolResults[0].visualEgress.receipt,
          providerId: 'openai',
          providerOrigin: 'https://api.openai.com',
          payloadDigest: toolResults[0].visualEgress.payloadDigest,
          mimeType: toolResults[0].visualEgress.mimeType,
          bytes: toolResults[0].visualEgress.bytes,
        }));
        assert.strictEqual(consumed.authorized, true);
        return {
          responseId: 'browser-turn-5',
          text: '',
          toolCalls: [
            {
              callId: 'browser-inspect',
              name: 'inspect_browser_preview',
              input: { sessionId: activeSessionId },
            },
            {
              callId: 'browser-close',
              name: 'close_browser_preview',
              input: { sessionId: activeSessionId },
            },
          ],
        };
      }

      assert.strictEqual(turn, 6);
      assert.strictEqual(toolResults.length, 2);
      const inspected = JSON.parse(toolResults[0].output);
      const closed = JSON.parse(toolResults[1].output);
      assert.strictEqual(inspected.ok, true);
      assert.strictEqual(inspected.data.console[0].message, 'preview ready');
      assert.strictEqual(closed.ok, true);
      assert.strictEqual(closed.data.closed, true);
      return {
        responseId: 'browser-turn-6',
        text: '',
        toolCalls: [{
          callId: 'browser-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'Preview visual validado.' },
        }],
      };
    },
    setJobCheckpoint() {},
    shouldUseModel: () => true,
    maxSteps: 8,
  });

  const result = await service.executeAction({
    type: 'agentic_tool_loop',
    userMessage: 'Perform a visual audit of the local preview and capture it. Do not finish as success unless tool evidence confirms that the approved visual image was delivered to the model.',
    attachments: [],
    conversationMessages: [],
    jobId: 'job-browser-tool-loop',
  }, {
    id: 'project-browser-tool-loop',
    rootPath: '/projects/browser-tool-loop',
    realRootPath: '/private/projects/browser-tool-loop',
  }, Object.freeze({
    jobId: 'job-browser-tool-loop',
    authorizeVisualEgress(input) {
      visualApprovalCalls.push(input);
      return Promise.resolve({
        ok: true,
        approved: true,
        reason: 'visual_egress_approved',
        receipt: visualReceipt,
      });
    },
    consumeVisualEgress(input) {
      visualConsumptionCalls.push(input);
      return Object.freeze({
        ok: true,
        authorized: true,
        reason: 'visual_egress_consumed',
      });
    },
    openBrowser(input) {
      calls.push({ operation: 'open', input });
      return Promise.resolve({ status: 'completed', decision: 'allow', output: { ok: true, session } });
    },
    navigateBrowser(input) {
      calls.push({ operation: 'navigate', input });
      return Promise.resolve({
        status: 'completed',
        decision: 'allow',
        output: {
          ok: true,
          session: { ...session, url: input.url, updatedAt: '2026-08-26T12:00:02.000Z' },
        },
      });
    },
    interactBrowser(input) {
      calls.push({ operation: 'interact', input });
      return Promise.resolve({
        ok: true,
        action: input.action,
        selector: input.selector,
        tagName: 'input',
        value: input.value,
      });
    },
    captureBrowser(input) {
      calls.push({ operation: 'capture', input });
      return Promise.resolve({
        ok: true,
        session,
        image: { type: 'image', mimeType: 'image/png', data: pngBase64, bytes: png.length },
      });
    },
    inspectBrowser(input) {
      calls.push({ operation: 'inspect', input });
      return {
        ok: true,
        session,
        console: [{
          level: 1,
          message: 'preview ready',
          line: 1,
          sourceId: 'app.js',
          createdAt: '2026-08-26T12:00:03.000Z',
        }],
        requestFailures: [],
      };
    },
    closeBrowser(input) {
      calls.push({ operation: 'close', input });
      return { ok: true, closed: true, sessionId: input.sessionId };
    },
  }));

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(calls.map((entry) => entry.operation), [
    'open',
    'navigate',
    'interact',
    'capture',
    'inspect',
    'close',
  ]);
  assert.ok(calls.every((entry) => Object.isFrozen(entry.input)));
  const captureInvocation = calls.find((entry) => entry.operation === 'capture');
  assert(captureInvocation);
  assert.deepStrictEqual(Object.keys(captureInvocation.input).sort(), [
    'callId',
    'invocationId',
    'sessionId',
  ]);
  assert.strictEqual(captureInvocation.input.callId, 'browser-capture');
  assert.match(
    captureInvocation.input.invocationId,
    /^browser-capture:4:[a-f0-9]{32}$/
  );
  assert.strictEqual(visualApprovalCalls.length, 1);
  assert.strictEqual(visualConsumptionCalls.length, 1);
  assert.deepStrictEqual(visualApprovalCalls[0], {
    jobId: 'job-browser-tool-loop',
    callId: 'browser-capture',
    payloadDigest: pngDigest,
    mimeType: 'image/png',
    bytes: png.length,
  });
  assert(Object.isFrozen(visualApprovalCalls[0]));
  assert.deepStrictEqual(result.toolRuns.map((entry) => entry.toolName), [
    'open_browser_preview',
    'navigate_browser_preview',
    'interact_browser_preview',
    'capture_browser_preview',
    'inspect_browser_preview',
    'close_browser_preview',
    'finish_task',
  ]);
  assert.match(result.message, /preview visual capturado/i);
  assert.doesNotMatch(result.message, /preview não foi capturado/i);
  assert.deepStrictEqual(result.terminalEvidence.required.browser, [
    'opened',
    'captured',
    'visual_delivered',
  ]);
  assert.deepStrictEqual(result.terminalEvidence.satisfied.browser, [
    'opened',
    'inspected',
    'captured',
    'visual_delivered',
  ]);

  // A local PNG is not proof that the model received visual evidence. If the
  // fresh egress approval is denied or expires, a visual audit cannot finish
  // successfully on the capture receipt alone.
  const deniedVisualEvents = [];
  let deniedVisualTurn = 0;
  const deniedVisualService = createAgenticToolLoopService({
    appendJobEvent(jobId, type, payload) {
      deniedVisualEvents.push({ jobId, type, payload });
    },
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async ({ toolResults }) => {
      deniedVisualTurn += 1;
      if (deniedVisualTurn === 1) {
        return {
          responseId: 'visual-denied-1',
          text: '',
          toolCalls: [{
            callId: 'visual-denied-open',
            name: 'open_browser_preview',
            input: { url: session.url, viewport: session.viewport },
          }],
        };
      }
      if (deniedVisualTurn === 2) {
        return {
          responseId: 'visual-denied-2',
          text: '',
          toolCalls: [{
            callId: 'visual-denied-capture',
            name: 'capture_browser_preview',
            input: { sessionId: session.id },
          }],
        };
      }
      assert.strictEqual(toolResults.length, 1);
      assert.strictEqual(Object.hasOwn(toolResults[0], 'visual'), false);
      return {
        responseId: 'visual-denied-3',
        text: '',
        toolCalls: [{
          callId: 'visual-denied-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'auditoria visual concluida' },
        }],
      };
    },
    setJobCheckpoint() {},
    shouldUseModel: () => true,
    maxSteps: 3,
  });
  const deniedVisualResult = await deniedVisualService.executeAction({
    type: 'agentic_tool_loop',
    userMessage: 'Perform a visual audit and capture the browser preview.',
    attachments: [],
    conversationMessages: [],
    jobId: 'job-visual-egress-denied',
  }, {
    id: 'project-browser-tool-loop',
    rootPath: '/projects/browser-tool-loop',
  }, Object.freeze({
    jobId: 'job-visual-egress-denied',
    authorizeVisualEgress: async () => Object.freeze({
      ok: false,
      approved: false,
      reason: 'visual_egress_expired',
      receipt: null,
    }),
    openBrowser: async () => ({
      status: 'completed',
      decision: 'allow',
      output: { ok: true, session },
    }),
    navigateBrowser: async () => ({
      status: 'completed',
      decision: 'allow',
      output: { ok: true, session },
    }),
    interactBrowser: async () => ({ ok: true }),
    captureBrowser: async () => ({
      ok: true,
      session,
      image: { type: 'image', mimeType: 'image/png', data: pngBase64, bytes: png.length },
    }),
    inspectBrowser: async () => ({ ok: true, session, console: [], requestFailures: [] }),
    closeBrowser: async () => ({ ok: true, closed: true, sessionId: session.id }),
  }));
  assert.strictEqual(deniedVisualResult.ok, false);
  const deniedVisualFinish = deniedVisualEvents.find((entry) => (
    entry.type === 'job.agentic_tool_result'
    && entry.payload.toolName === 'finish_task'
  ));
  assert(deniedVisualFinish);
  assert.strictEqual(deniedVisualFinish.payload.ok, false);
  assert.match(deniedVisualFinish.payload.message, /captura.*provedor|evidencia visual/i);

  // Browser verbs explicitly requested by the user are evidence obligations.
  // A textual finish_task claim cannot replace a governed open receipt.
  const prematureBrowserEvents = [];
  const prematureBrowserService = createAgenticToolLoopService({
    appendJobEvent(jobId, type, payload) {
      prematureBrowserEvents.push({ jobId, type, payload });
    },
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async () => ({
      responseId: 'premature-browser-finish-1',
      text: '',
      toolCalls: [{
        callId: 'premature-browser-finish',
        name: 'finish_task',
        input: { status: 'success', summary: 'preview preparado' },
      }],
    }),
    setJobCheckpoint() {},
    shouldUseModel: () => true,
    maxSteps: 1,
  });
  const prematureBrowserResult = await prematureBrowserService.executeAction({
    type: 'agentic_tool_loop',
    userMessage: 'Abra o preview no navegador governado antes de concluir. Não capture imagens.',
    attachments: [],
    conversationMessages: [],
    jobId: 'job-premature-browser-finish',
  }, {
    id: 'project-browser-tool-loop',
    rootPath: '/projects/browser-tool-loop',
  }, Object.freeze({
    jobId: 'job-premature-browser-finish',
    openBrowser: async () => ({ status: 'completed', decision: 'allow', output: { ok: true, session } }),
    navigateBrowser: async () => ({ status: 'completed', decision: 'allow', output: { ok: true, session } }),
    interactBrowser: async () => ({ ok: true }),
    captureBrowser: async () => ({
      ok: true,
      session,
      image: { type: 'image', mimeType: 'image/png', data: pngBase64, bytes: png.length },
    }),
    inspectBrowser: async () => ({ ok: true, session, console: [], requestFailures: [] }),
    closeBrowser: async () => ({ ok: true, closed: true, sessionId: session.id }),
  }));
  assert.strictEqual(prematureBrowserResult.ok, false);
  const rejectedPrematureBrowserFinish = prematureBrowserEvents.find(
    (entry) => entry.type === 'job.agentic_tool_result'
      && entry.payload && entry.payload.toolName === 'finish_task'
  );
  assert(rejectedPrematureBrowserFinish);
  assert.strictEqual(rejectedPrematureBrowserFinish.payload.ok, false);
  assert.match(rejectedPrematureBrowserFinish.payload.message, /abrir.*preview/i);
  assert.doesNotMatch(rejectedPrematureBrowserFinish.payload.message, /captur/i);

  // An explicit user prohibition has precedence over positive browser verbs,
  // including a contradictory execution message produced by the internal route.
  // Negated preview language must never become a browser evidence obligation.
  const deniedBrowserCases = [
    {
      id: 'pt-nao-abra',
      userMessage: 'Faça uma auditoria somente leitura. Não abra preview no navegador.',
      routeDecision: {
        executionMessage: 'Abra o preview no navegador antes de concluir.',
      },
    },
    {
      id: 'pt-sem-abrir',
      userMessage: 'Faça uma auditoria somente leitura sem abrir o preview.',
      routeDecision: null,
    },
    {
      id: 'en-do-not-open',
      userMessage: 'Read the project tree. Do not open the browser preview.',
      routeDecision: null,
    },
  ];
  for (const deniedCase of deniedBrowserCases) {
    let deniedTurn = 0;
    const deniedService = createAgenticToolLoopService({
      appendJobEvent() {},
      executeCapability: async () => ({ ok: true }),
      executeTool: async () => ({ ok: true }),
      getEffectiveOpenAiModel: () => 'gpt-5-codex',
      getSelectedAiProvider: () => 'openai',
      requestModelTurn: async () => {
        deniedTurn += 1;
        if (deniedTurn === 1) {
          return {
            responseId: `denied-browser-${deniedCase.id}-1`,
            text: '',
            toolCalls: [{
              callId: `denied-browser-tree-${deniedCase.id}`,
              name: 'project_tree',
              input: {},
            }],
          };
        }
        return {
          responseId: `denied-browser-${deniedCase.id}-2`,
          text: '',
          toolCalls: [{
            callId: `denied-browser-finish-${deniedCase.id}`,
            name: 'finish_task',
            input: { status: 'success', summary: 'auditoria somente leitura concluída' },
          }],
        };
      },
      setJobCheckpoint() {},
      shouldUseModel: () => true,
      maxSteps: 2,
    });
    const deniedResult = await deniedService.executeAction({
      type: 'agentic_tool_loop',
      userMessage: deniedCase.userMessage,
      routeDecision: deniedCase.routeDecision,
      attachments: [],
      conversationMessages: [],
      jobId: `job-denied-browser-${deniedCase.id}`,
    }, {
      id: 'project-browser-tool-loop',
      rootPath: '/projects/browser-tool-loop',
    }, Object.freeze({ jobId: `job-denied-browser-${deniedCase.id}` }));
    assert.strictEqual(deniedResult.ok, true, deniedCase.id);
    assert.strictEqual(deniedTurn, 2, deniedCase.id);
    assert.deepStrictEqual(deniedResult.terminalEvidence.required.browser, [], deniedCase.id);
  }

  let failureTurn = 0;
  let sanitizedInteractionFailure = null;
  const interactionFailureService = createAgenticToolLoopService({
    appendJobEvent() {},
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async ({ toolResults }) => {
      failureTurn += 1;
      if (failureTurn === 1) {
        return {
          responseId: 'browser-failure-turn-1',
          text: '',
          toolCalls: [{
            callId: 'browser-missing-element',
            name: 'interact_browser_preview',
            input: {
              sessionId: session.id,
              action: 'click',
              selector: '[data-testid="missing"]',
              idempotencyKey: 'browser-click-missing-1',
            },
          }],
        };
      }
      sanitizedInteractionFailure = JSON.parse(toolResults[0].output);
      return {
        responseId: 'browser-failure-turn-2',
        text: '',
        toolCalls: [{
          callId: 'finish-browser-failure-diagnostic',
          name: 'finish_task',
          input: { status: 'failure', summary: 'elemento não encontrado' },
        }],
      };
    },
    setJobCheckpoint() {},
    shouldUseModel: () => true,
    maxSteps: 3,
  });
  const interactionFailureResult = await interactionFailureService.executeAction({
    type: 'agentic_tool_loop',
    userMessage: 'Audite o preview em modo somente leitura.',
    attachments: [],
    conversationMessages: [],
    jobId: 'job-browser-interaction-failure',
  }, {
    id: 'project-browser-tool-loop',
    rootPath: '/projects/browser-tool-loop',
  }, Object.freeze({
    jobId: 'job-browser-interaction-failure',
    openBrowser: async () => ({ status: 'completed', decision: 'allow', output: { ok: true, session } }),
    navigateBrowser: async () => ({ status: 'completed', decision: 'allow', output: { ok: true, session } }),
    interactBrowser: async () => ({ ok: false, reason: 'element_not_found' }),
    captureBrowser: async () => ({ ok: true, session, image: { type: 'image', mimeType: 'image/png', data: pngBase64, bytes: png.length } }),
    inspectBrowser: async () => ({ ok: true, session, console: [], requestFailures: [] }),
    closeBrowser: async () => ({ ok: true, closed: true, sessionId: session.id }),
  }));
  assert.strictEqual(interactionFailureResult.ok, false);
  assert.deepStrictEqual(sanitizedInteractionFailure.errors, ['BROWSER_INTERACTION_ELEMENT_NOT_FOUND']);
  assert.match(sanitizedInteractionFailure.message, /elemento solicitado não foi encontrado/i);

  console.log('agentic-browser-tool-loop.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
