const assert = require('assert');

const { createProjectVisualValidationRuntimeService } = require('../main/services/project_visual_validation_runtime_service');

const passingArtifactQuality = {
  enabled: true,
  score: 92,
  minScore: 70,
  passesMinimum: true,
  checks: {},
  issues: [],
  criticalFailures: [],
};

function createAction(artifactQuality = passingArtifactQuality) {
  return {
    type: 'operation_batch',
    intent: 'init_project',
    executionValidation: {
      score: 86,
      minScore: 55,
      technicalChecksPassed: true,
      artifactQuality,
      visualValidation: {
        required: true,
      },
    },
  };
}

async function testCaptureIssueBlocksCompletion() {
  let previewCalls = 0;
  let captureCalls = 0;
  let previewOptions = null;
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => passingArtifactQuality,
    startProjectPreview: async (_, options) => {
      previewCalls += 1;
      previewOptions = options;
      return {
        ok: true,
        session: {
          status: 'ready',
          mode: 'file',
          url: 'file:///tmp/index.html',
        },
      };
    },
    captureProjectPreview: async ({ viewport }) => {
      captureCalls += 1;
      return {
        ok: true,
        path: `/tmp/faber-capture-${viewport.id}.png`,
        viewport,
        analysis: { blankLikely: true, horizontalOverflow: false },
        issues: [
          {
            id: 'capture_blank',
            severity: 'error',
            detail: 'Captura parece vazia ou uniforme demais.',
          },
        ],
      };
    },
    evaluateVisualBriefingSemantics: () => ({ enabled: false }),
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: createAction(),
      userMessage: 'criar site de chocolate premium',
      executionIntent: 'init_project',
    }
  );

  assert.strictEqual(previewCalls, 1);
  assert.strictEqual(previewOptions.reuseActiveSession, true);
  assert.strictEqual(previewOptions.preferExistingServer, true);
  assert.strictEqual(previewOptions.autoInstallDependencies, true);
  assert.strictEqual(captureCalls, 3);
  assert.strictEqual(report.required, true);
  assert.strictEqual(report.status, 'failed');
  assert.strictEqual(report.passesMinimum, false);
  assert.strictEqual(report.staticPassesMinimum, true);
  assert.strictEqual(report.capture.status, 'captured');
  assert.strictEqual(report.capture.viewportCount, 3);
  assert.strictEqual(report.capture.capturedViewportCount, 3);
  assert.strictEqual(report.capture.failedViewportCount, 0);
  assert.strictEqual(report.capture.viewports.length, 3);
  assert.match(report.summary, /Tecnicamente passou/);
  assert.match(report.summary, /Visualmente falhou/);

  const gate = service.evaluateVisualValidationGate(report);
  assert.strictEqual(gate.shouldBlock, true);
  assert.strictEqual(gate.reason, 'visual_validation_failed');
  assert.match(service.buildVisualValidationGateMessage(gate), /validação visual/i);

  const diagnostics = service.buildVisualValidationDiagnosticsHint(report);
  assert.ok(diagnostics.summary.errors >= 1);
  assert.ok(diagnostics.issues.some((issue) => issue.source.includes('capture_blank')));
}

async function testPreviewFailureBlocksWithoutRealCapture() {
  let captureCalls = 0;
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => passingArtifactQuality,
    startProjectPreview: async () => ({
      ok: false,
      message: 'Preview bloqueado.',
    }),
    captureProjectPreview: async () => {
      captureCalls += 1;
      return { ok: true };
    },
    evaluateVisualBriefingSemantics: () => ({ enabled: false }),
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: createAction(),
      userMessage: 'criar landing page',
      executionIntent: 'init_project',
    }
  );

  assert.strictEqual(captureCalls, 0);
  assert.strictEqual(report.status, 'failed');
  assert.strictEqual(report.passesMinimum, false);
  assert.strictEqual(report.staticPassesMinimum, true);
  assert.strictEqual(report.capture.status, 'capture_failed');
  assert.ok(report.issues.some((issue) => issue.id === 'preview_not_ready'));
  const gate = service.evaluateVisualValidationGate(report);
  assert.strictEqual(gate.shouldBlock, true);
  assert.strictEqual(gate.reason, 'visual_validation_capture_required');
  assert.strictEqual(gate.autoRepairable, false);
  assert.strictEqual(gate.retryable, false);
  assert.strictEqual(gate.warning, false);
}

async function testPreviewCodeRuntimeFailureAllowsAutoRepair() {
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => passingArtifactQuality,
    startProjectPreview: async () => ({
      ok: false,
      message: 'Preview HTTP respondeu com status 500. ReferenceError: document is not defined at app/page.tsx (539:15).',
      session: {
        status: 'failed',
        url: 'http://127.0.0.1:3000/',
      },
    }),
    evaluateVisualBriefingSemantics: () => ({ enabled: false }),
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: createAction(),
      userMessage: 'criar Forge MRP em Next.js',
      executionIntent: 'init_project',
    }
  );

  assert.strictEqual(report.status, 'failed');
  assert.ok(report.issues.some((issue) => issue.id === 'preview_not_ready'));
  const gate = service.evaluateVisualValidationGate(report);
  assert.strictEqual(gate.shouldBlock, true);
  assert.strictEqual(gate.reason, 'visual_validation_preview_not_ready');
  assert.strictEqual(gate.autoRepairable, true);
  assert.strictEqual(gate.retryable, true);
}

async function testSemanticBriefingMismatchBlocksCompletion() {
  let captureCalls = 0;
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => passingArtifactQuality,
    startProjectPreview: async () => ({
      ok: true,
      session: {
        status: 'ready',
        mode: 'file',
        url: 'file:///tmp/index.html',
      },
    }),
    captureProjectPreview: async ({ viewport }) => {
      captureCalls += 1;
      return {
        ok: true,
        path: `/tmp/faber-capture-${viewport.id}.png`,
        viewport,
        analysis: { blankLikely: false, horizontalOverflow: false },
        pageSnapshot: {
          title: 'Atelier Couro Faber',
          bodyText: 'Bolsas de couro, pastas, carteiras e artefatos de couro feitos a mao.',
          headings: ['Pecas de couro feitas para atravessar anos'],
          buttons: ['Conhecer colecoes'],
          images: [{ src: 'assets/couro.jpg', alt: 'costura em couro' }],
          videos: [],
          iframes: [],
          svgCount: 1,
          iconLikeCount: 1,
          sectionCount: 4,
          formCount: 0,
          computedTokens: [],
        },
        issues: [],
      };
    },
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: createAction(),
      userMessage: 'Criar site de chocolate artesanal premium com video, produtos, processo e CTA comprar agora.',
      executionIntent: 'init_project',
    }
  );

  assert.strictEqual(report.status, 'failed');
  assert.strictEqual(report.capture.status, 'captured');
  assert.strictEqual(captureCalls, 3);
  assert.strictEqual(report.capture.viewportCount, 3);
  assert.strictEqual(report.capture.semantic.passesMinimum, false);
  assert.strictEqual(report.capture.viewports[0].semantic.passesMinimum, false);
  assert.ok(report.issues.some((issue) => issue.id === 'semantic_visual_minimum'));
  assert.ok(report.issues.some((issue) => issue.id === 'semantic_domain_adherence'));
  const gate = service.evaluateVisualValidationGate(report);
  assert.strictEqual(gate.shouldBlock, true);
  assert.strictEqual(gate.reason, 'visual_validation_failed');
  assert.strictEqual(gate.autoRepairable, false);
  assert.strictEqual(gate.retryable, false);
  assert.strictEqual(gate.semanticFailure, true);
  assert.match(service.buildVisualValidationGateMessage(gate), /aderência ao briefing/i);
}

async function testProductCoverageMissingPromisedSectionsBlocksCompletion() {
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => passingArtifactQuality,
    evaluateVisualBriefingSemantics: () => ({ enabled: false }),
    startProjectPreview: async () => ({
      ok: true,
      session: {
        status: 'ready',
        mode: 'file',
        url: 'file:///tmp/index.html',
      },
    }),
    captureProjectPreview: async ({ viewport }) => ({
      ok: true,
      path: `/tmp/faber-capture-${viewport.id}.png`,
      viewport,
      analysis: { blankLikely: false, horizontalOverflow: false, visibleTextBlocks: 8 },
      pageSnapshot: {
        title: 'Atelie Madeira Viva',
        bodyText: 'Esculturas em madeira com chamada para encomendas especiais.',
        headings: ['Esculturas em madeira para casas e jardins'],
        buttons: ['Encomendar agora'],
        aboveFold: {
          text: 'Esculturas em madeira para casas e jardins Encomendar agora',
          headings: ['Esculturas em madeira para casas e jardins'],
          buttons: ['Encomendar agora'],
          hasH1: true,
          visibleTextBlocks: 6,
          mediaCount: 1,
        },
        ctaCandidates: [
          { text: 'Encomendar agora', href: '#contato', aboveFold: true, visibleInViewport: true },
        ],
        sections: [
          {
            tag: 'section',
            id: 'hero',
            heading: 'Esculturas em madeira para casas e jardins',
            text: 'Esculturas em madeira para casas e jardins. Encomendar agora.',
            buttonTexts: ['Encomendar agora'],
            mediaCount: 1,
            aboveFold: true,
            visibleInViewport: true,
          },
        ],
        images: [{ src: 'assets/madeira.jpg', alt: 'escultura em madeira' }],
        videos: [],
        iframes: [],
        svgCount: 2,
        iconLikeCount: 2,
        sectionCount: 1,
        formCount: 0,
        computedTokens: [],
      },
      issues: [],
    }),
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: createAction(),
      userMessage: 'Criar site completo com hero, CTA, loja de produtos, blog, galeria/portfolio, depoimentos, contato com formulario e footer.',
      executionIntent: 'init_project',
      captureOptions: {
        viewports: [
          { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
        ],
      },
    }
  );

  assert.strictEqual(report.status, 'failed');
  assert.strictEqual(report.capture.status, 'captured');
  assert.strictEqual(report.capture.productCoverage.passesMinimum, false);
  assert.strictEqual(report.capture.viewports[0].productCoverage.passesMinimum, false);
  assert.ok(report.issues.some((issue) => issue.id === 'product_section_missing_blog'));
  assert.ok(report.issues.some((issue) => issue.id === 'product_section_missing_contactForm'));
  assert.strictEqual(service.evaluateVisualValidationGate(report).shouldBlock, true);
}

async function testViewportCaptureEvidencePassesCompletion() {
  const capturedViewports = [];
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => passingArtifactQuality,
    evaluateVisualBriefingSemantics: () => ({ enabled: false }),
    startProjectPreview: async () => ({
      ok: true,
      session: {
        status: 'ready',
        mode: 'file',
        url: 'file:///tmp/index.html',
      },
    }),
    captureProjectPreview: async ({ viewport }) => {
      capturedViewports.push(viewport.id);
      return {
        ok: true,
        path: `/tmp/faber-capture-${viewport.id}.png`,
        viewport,
        analysis: {
          blankLikely: false,
          horizontalOverflow: false,
          visibleTextBlocks: 8,
        },
        pageSnapshot: {
          title: 'Maison Cacao',
          bodyText: 'Chocolate artesanal premium com produtos, processo e CTA comprar agora.',
          headings: ['Chocolate feito para ser sentido'],
          buttons: ['Comprar agora', 'Conhecer produtos'],
          images: [{ src: 'assets/chocolate.jpg', alt: 'chocolate artesanal' }],
          videos: [],
          iframes: [],
          svgCount: 2,
          iconLikeCount: 2,
          sectionCount: 5,
          formCount: 1,
          computedTokens: [],
        },
        issues: [],
      };
    },
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: createAction(),
      userMessage: 'criar site de chocolate premium',
      executionIntent: 'init_project',
      captureOptions: {
        viewports: [
          { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
          { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
        ],
      },
    }
  );

  assert.deepStrictEqual(capturedViewports, ['desktop', 'mobile']);
  assert.strictEqual(report.status, 'passed');
  assert.strictEqual(report.passesMinimum, true);
  assert.strictEqual(report.staticPassesMinimum, true);
  assert.strictEqual(report.capture.status, 'captured');
  assert.strictEqual(report.capture.viewportCount, 2);
  assert.strictEqual(report.capture.capturedViewportCount, 2);
  assert.strictEqual(report.capture.failedViewportCount, 0);
  assert.strictEqual(report.capture.artifactPaths.length, 2);
  assert.match(report.summary, /captura real em 2\/2 viewport/);
  assert.strictEqual(service.evaluateVisualValidationGate(report).shouldBlock, false);
}

async function testBrowserPreviewCapabilityFeedsVisualRuntime() {
  let directPreviewCalls = 0;
  let capabilityCalls = 0;
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => passingArtifactQuality,
    evaluateVisualBriefingSemantics: () => ({ enabled: false }),
    startProjectPreview: async () => {
      directPreviewCalls += 1;
      return { ok: false };
    },
    executeBrowserPreviewCapability: async (_, options) => {
      capabilityCalls += 1;
      assert.deepStrictEqual(options.captureOptions.viewports, [
        { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
      ]);
      return {
        ok: true,
        evidence: {
          data: {
            preview: {
              ok: true,
              session: {
                status: 'ready',
                mode: 'server',
                url: 'http://127.0.0.1:3000/',
              },
            },
            captures: [
              {
                ok: true,
                path: '/tmp/faber-capability-desktop.png',
                viewport: { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
                analysis: {
                  blankLikely: false,
                  horizontalOverflow: false,
                  visibleTextBlocks: 8,
                },
                pageSnapshot: {
                  title: 'Maison Cacao',
                  bodyText: 'Chocolate artesanal premium com produtos e CTA comprar agora.',
                  headings: ['Chocolate feito para ser sentido'],
                  buttons: ['Comprar agora'],
                  images: [{ src: 'assets/chocolate.jpg', alt: 'chocolate artesanal' }],
                  videos: [],
                  iframes: [],
                  svgCount: 2,
                  iconLikeCount: 2,
                  sectionCount: 5,
                  formCount: 1,
                  computedTokens: [],
                },
                issues: [],
              },
            ],
          },
        },
      };
    },
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: createAction(),
      userMessage: 'criar site de chocolate premium',
      executionIntent: 'init_project',
      captureOptions: {
        viewports: [
          { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
        ],
      },
    }
  );

  assert.strictEqual(capabilityCalls, 1);
  assert.strictEqual(directPreviewCalls, 0);
  assert.strictEqual(report.status, 'passed');
  assert.deepStrictEqual(report.capture.artifactPaths, ['/tmp/faber-capability-desktop.png']);
}

async function testSearchActionSkipsVisualRuntime() {
  let previewCalls = 0;
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => ({ enabled: false }),
    startProjectPreview: async () => {
      previewCalls += 1;
      return { ok: true };
    },
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: { type: 'search_text_in_files' },
      userMessage: 'procure este texto nos arquivos',
      executionIntent: 'search',
    }
  );

  assert.strictEqual(previewCalls, 0);
  assert.strictEqual(report.status, 'not_required');
  assert.strictEqual(service.evaluateVisualValidationGate(report).shouldBlock, false);
}

async function testRuntimeCompatibilityPatchSkipsVisualRuntime() {
  let previewCalls = 0;
  let artifactQualityCalls = 0;
  const service = createProjectVisualValidationRuntimeService({
    evaluateOperationBatchArtifactQuality: () => {
      artifactQualityCalls += 1;
      return passingArtifactQuality;
    },
    startProjectPreview: async () => {
      previewCalls += 1;
      return { ok: true };
    },
  });

  const report = await service.runProjectVisualValidation(
    { rootPath: '/tmp/app' },
    {
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        generatedBy: 'deterministic_structured_clone_compat_patch',
        operations: [
          { op: 'write_file', path: 'lib/mrp.ts', content: 'export {};\n' },
        ],
        microContract: {
          type: 'runtime_test_compatibility',
        },
        executionValidation: {
          score: 93,
          minScore: 55,
          technicalChecksPassed: true,
        },
      },
      userMessage: 'Corrija ReferenceError structuredClone is not defined nos testes Jest.',
      executionIntent: 'edit_project',
    }
  );

  assert.strictEqual(previewCalls, 0);
  assert.strictEqual(artifactQualityCalls, 0);
  assert.strictEqual(report.status, 'not_required');
  assert.strictEqual(report.required, false);
  assert.strictEqual(service.evaluateVisualValidationGate(report).shouldBlock, false);
}

async function run() {
  await testCaptureIssueBlocksCompletion();
  await testPreviewFailureBlocksWithoutRealCapture();
  await testPreviewCodeRuntimeFailureAllowsAutoRepair();
  await testSemanticBriefingMismatchBlocksCompletion();
  await testProductCoverageMissingPromisedSectionsBlocksCompletion();
  await testViewportCaptureEvidencePassesCompletion();
  await testBrowserPreviewCapabilityFeedsVisualRuntime();
  await testSearchActionSkipsVisualRuntime();
  await testRuntimeCompatibilityPatchSkipsVisualRuntime();
  console.log('project-visual-validation-runtime-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
