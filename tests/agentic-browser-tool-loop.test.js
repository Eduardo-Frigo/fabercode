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
  let turn = 0;
  let activeSessionId = '';

  const service = createAgenticToolLoopService({
    appendJobEvent() {},
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async ({ systemPrompt, tools, toolResults }) => {
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
    userMessage: 'Valide visualmente o preview local.',
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
  assert.strictEqual(visualApprovalCalls.length, 1);
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
  console.log('agentic-browser-tool-loop.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
