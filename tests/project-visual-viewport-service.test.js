const assert = require('assert');

const {
  DEFAULT_VISUAL_VIEWPORTS,
  buildViewportCaptureSet,
  normalizeVisualViewport,
  normalizeVisualViewportSet,
} = require('../main/services/project_visual_viewport_service');

function run() {
  assert.strictEqual(DEFAULT_VISUAL_VIEWPORTS.length, 3);

  const normalized = normalizeVisualViewport({ label: 'Mobile Pequeno', width: 280, height: 120 }, 0);
  assert.strictEqual(normalized.id, 'mobile-pequeno');
  assert.strictEqual(normalized.width, 320);
  assert.strictEqual(normalized.height, 240);

  const viewportSet = normalizeVisualViewportSet([
    { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
    { id: 'desktop', label: 'Desktop duplicado', width: 1365, height: 768 },
    { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
  ]);
  assert.deepStrictEqual(viewportSet.map((viewport) => viewport.id), ['desktop', 'mobile']);

  const aggregate = buildViewportCaptureSet([
    {
      ok: true,
      path: '/tmp/desktop.png',
      viewport: { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
      analysis: { blankLikely: false, horizontalOverflow: false },
      issues: [],
    },
    {
      ok: false,
      reason: 'capture_failed',
      viewport: { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
      issues: [
        {
          id: 'capture_failed',
          severity: 'error',
          detail: 'ERR_EMPTY_RESPONSE',
        },
      ],
    },
  ]);

  assert.strictEqual(aggregate.ok, false);
  assert.strictEqual(aggregate.reason, 'viewport_capture_failed');
  assert.strictEqual(aggregate.viewportCount, 2);
  assert.strictEqual(aggregate.capturedViewportCount, 1);
  assert.strictEqual(aggregate.failedViewportCount, 1);
  assert.deepStrictEqual(aggregate.paths, ['/tmp/desktop.png']);
  assert.strictEqual(aggregate.analysis.viewportResults.length, 2);
  assert.ok(aggregate.issues[0].detail.includes('[Mobile 390x844]'));

  const passed = buildViewportCaptureSet([
    {
      ok: true,
      path: '/tmp/desktop.png',
      viewport: { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
      issues: [],
    },
    {
      ok: true,
      path: '/tmp/mobile.png',
      viewport: { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
      issues: [],
    },
  ]);
  assert.strictEqual(passed.ok, true);
  assert.strictEqual(passed.capturedViewportCount, 2);

  console.log('project-visual-viewport-service.test.js: ok');
}

run();
