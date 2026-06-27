const assert = require('assert');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

const { createFaberCapabilityAdapterService } = require('../main/services/faber_capability_adapter_service');
const { createArtifactStoreService } = require('../main/services/artifact_store_service');
const { createProjectVisualValidationRuntimeService } = require('../main/services/project_visual_validation_runtime_service');
const {
  createSmokeHarness,
  normalizeSmokeText,
} = require('./support/smoke_scenario_runner');

const VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 900 },
];

const CASES = [
  {
    id: 'simple_imc_calculator_tool',
    category: 'ferramenta simples',
    message: [
      'Crie uma ferramenta simples em Next.js chamada FitCalc IMC.',
      'Precisa ser uma calculadora de IMC com peso, altura, resultado, classificacao, historico local, CTA para calcular agora e conteudo final sem placeholder.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes tinhamos falado de SaaS generico com dashboard e planos.' },
    ],
    expected: {
      temporary: true,
      domainPrefix: 'temporary-fitcalc-imc',
      requiredTerms: ['fitcalc imc', 'calculadora de imc', 'peso', 'altura', 'classificacao', 'formula'],
      forbiddenTerms: ['faber workspace', 'dashboard executivo', 'planos'],
    },
    edits: [
      {
        message: 'Mude o titulo da pagina ja desenvolvida para "FitCalc IMC validada"',
        expectedGenerator: 'deterministic_title_edit_patch',
        requiredTerms: ['fitcalc imc validada'],
      },
    ],
    visual: {
      title: 'FitCalc IMC',
      subtitle: 'Calculadora simples com peso, altura, IMC e classificacao.',
      sections: ['Entradas', 'Formula', 'Resultado', 'Historico', 'Contato'],
      chips: ['IMC', 'peso', 'altura', 'classificacao'],
      hasCalculator: true,
      hasForm: true,
      repairProbe: true,
    },
  },
  {
    id: 'institutional_temporary_clinic',
    category: 'site institucional',
    message: [
      'Briefing completo: criar site institucional multipagina para Clinica Horizonte.',
      'Precisa ter Inicio, Sobre, Servicos, Equipe, Blog, Contato, formulario, depoimentos e conteudo final sem placeholder.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes o projeto era de jardinagem, Jardim Vivo e loja de plantas.' },
    ],
    expected: {
      temporary: true,
      domainPrefix: 'temporary-clinica-horizonte',
      requiredFiles: ['app/sobre/page.tsx', 'app/servicos/page.tsx', 'app/professores/page.tsx', 'app/blog/page.tsx', 'app/contato/page.tsx'],
      requiredTerms: ['clinica horizonte', 'servicos', 'blog', 'contato', 'formulario'],
      forbiddenTerms: ['jardim vivo', 'plantas internas', 'loja de jardinagem'],
    },
    edits: [
      {
        message: 'Adicione campo WhatsApp ao formulario',
        expectedGenerator: 'deterministic_form_field_patch',
        requiredTerms: ['whatsapp'],
      },
    ],
    visual: {
      title: 'Clinica Horizonte',
      subtitle: 'Site institucional multipagina com equipe, blog e contato.',
      sections: ['Hero', 'Sobre', 'Servicos', 'Equipe', 'Blog', 'Contato'],
      chips: ['temporario', 'multipagina', 'formulario'],
      hasForm: true,
    },
  },
  {
    id: 'vitrapure_product_landing',
    category: 'landing page',
    message: [
      'Briefing completo: criar landing page moderna para VitraPure.',
      'Garrafas de vidro reutilizaveis, livre de BPA, Essential 500ml, Aura 750ml, Terra 1L, sustentabilidade, prova social, FAQ, oferta e conteudo final sem placeholder.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes falamos de Atelier Couro Faber e bolsas de couro.' },
    ],
    expected: {
      domain: 'sustainable-product-landing',
      recipe: 'consumer-product-catalog-landing',
      requiredTerms: ['vitrapure', 'garrafas de vidro', 'essential 500ml', 'aura 750ml', 'terra 1l', 'livre de bpa'],
      forbiddenTerms: ['atelier couro faber', 'bolsas de couro', 'faber projeto'],
    },
    visual: {
      title: 'VitraPure',
      subtitle: 'Landing page de produto sustentavel com catalogo e oferta.',
      sections: ['Hero', 'Beneficios', 'Produtos', 'Sustentabilidade', 'Prova', 'FAQ'],
      chips: ['produto', 'catalogo', 'oferta'],
      hasForm: true,
    },
  },
  {
    id: 'alumivance_complex_calculator',
    category: 'ferramenta complexa',
    message: [
      'Briefing completo: criar site institucional completo para Alumivance Esquadrias & Fachadas.',
      'Precisa ter esquadrias de aluminio, fachadas em ACM, pele de vidro, projetos, blog, contato, trabalhe conosco e calculadora de orcamento.',
      'A calculadora deve usar valor estimado = area em m2 x valor base da solucao x multiplicador do acabamento x multiplicador do vidro.',
      'Use conteudo final sem placeholder.',
    ].join(' '),
    expected: {
      domain: 'technical-b2b-services-site',
      recipe: 'technical-b2b-lead-site',
      requiredFiles: ['app/calculadora/page.tsx', 'app/solucoes/page.tsx', 'app/projetos/page.tsx', 'app/trabalhe-conosco/page.tsx'],
      requiredTerms: ['alumivance esquadrias', 'calculadora de orcamento', 'basevalues', 'finishmultipliers', 'glassmultipliers'],
      forbiddenTerms: ['vitrapure', 'aurora di vento', 'helena duarte arquitetura'],
    },
    edits: [
      {
        message: 'Troque o href do CTA primario para /calculadora',
        expectedGenerator: 'deterministic_cta_text_patch',
        requiredTerms: ['/calculadora'],
      },
    ],
    visual: {
      title: 'Alumivance',
      subtitle: 'Site tecnico B2B com calculadora de orcamento.',
      sections: ['Hero tecnico', 'Solucoes', 'Calculadora', 'Projetos', 'Processo', 'Contato'],
      chips: ['ACM', 'pele de vidro', 'orcamento'],
      hasCalculator: true,
      hasForm: true,
    },
  },
  {
    id: 'taskpulse_saas_landing',
    category: 'SaaS simples',
    message: [
      'Crie uma landing page SaaS em Next.js para TaskPulse.',
      'Ferramenta de produtividade para equipes com dashboard, automacoes, pipeline de trabalho, relatorios, permissoes, planos, FAQ, depoimentos e formulario para demo.',
      'Use conteudo final sem placeholder.',
    ].join(' '),
    expected: {
      domain: 'saas-tool',
      recipe: 'saas-tool-landing',
      requiredTerms: ['taskpulse', 'dashboard', 'pipeline', 'automacao', 'relatorios', 'planos'],
      forbiddenTerms: ['fitcalc imc', 'clinica horizonte', 'vitrapure', 'alumivance'],
    },
    edits: [
      {
        message: 'Mude o titulo da pagina ja desenvolvida para "TaskPulse operacional validado"',
        expectedGenerator: 'deterministic_title_edit_patch',
        requiredTerms: ['taskpulse operacional validado'],
      },
    ],
    visual: {
      title: 'TaskPulse',
      subtitle: 'Landing SaaS com workspace, metricas, planos e demo.',
      sections: ['Dashboard', 'Pipeline', 'Automacoes', 'Planos', 'FAQ', 'Demo'],
      chips: ['SaaS', 'workspace', 'demo'],
      hasForm: true,
    },
  },
];

function findElectron() {
  try {
    const electronPath = require('electron');
    return typeof electronPath === 'string' ? electronPath : null;
  } catch {
    return null;
  }
}

function analyzePng(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const colors = new Set();
  let opaque = 0;
  for (let y = 0; y < png.height; y += 14) {
    for (let x = 0; x < png.width; x += 14) {
      const idx = (png.width * y + x) << 2;
      if (png.data[idx + 3] > 0) opaque += 1;
      colors.add(`${png.data[idx]},${png.data[idx + 1]},${png.data[idx + 2]},${png.data[idx + 3]}`);
    }
  }
  return {
    width: png.width,
    height: png.height,
    sampledColors: colors.size,
    blankLikely: colors.size < 8 || opaque === 0,
  };
}

let electronCaptureScriptPath;

function getElectronCaptureScriptPath() {
  if (electronCaptureScriptPath) return electronCaptureScriptPath;
  electronCaptureScriptPath = path.join(os.tmpdir(), 'faber-full-tool-loop-electron-capture.js');
  fs.writeFileSync(electronCaptureScriptPath, `
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: payload.viewport.width,
    height: payload.viewport.height,
    useContentSize: true,
    resizable: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  });
  win.setContentSize(payload.viewport.width, payload.viewport.height, false);
  await win.loadFile(payload.htmlPath);
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const contentSize = win.getContentSize();
  const metrics = await win.webContents.executeJavaScript(\`
    (() => {
      const node = document.getElementById('metrics');
      if (!node || !node.textContent) throw new Error('metrics not found');
      const parsed = JSON.parse(node.textContent);
      parsed.electronContentWidth = \${contentSize[0]};
      parsed.electronContentHeight = \${contentSize[1]};
      return parsed;
    })()
  \`);
  const image = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: payload.viewport.width,
    height: payload.viewport.height,
  });
  const normalizedImage = image.resize({
    width: payload.viewport.width,
    height: payload.viewport.height,
    quality: 'best',
  });
  fs.writeFileSync(payload.pngPath, normalizedImage.toPNG());
  fs.writeFileSync(payload.metricsPath, JSON.stringify(metrics));
  win.destroy();
  app.quit();
}

main().catch((error) => {
  try {
    fs.writeFileSync(payload.errorPath, error && error.stack ? error.stack : String(error));
  } catch {}
  app.quit();
  setTimeout(() => process.exit(1), 20);
});
`, 'utf8');
  return electronCaptureScriptPath;
}

function createProjectInfo(rootPath, overrides = {}) {
  return {
    id: path.basename(rootPath),
    rootPath,
    files: [],
    stacks: [],
    totalFiles: 0,
    counters: {},
    ...overrides,
  };
}

function fileExists(rootPath, relPath) {
  return fs.existsSync(path.join(rootPath, relPath));
}

function readGeneratedText(harness, rootPath) {
  const project = harness.scanProject(rootPath);
  return normalizeSmokeText(
    project.files
      .filter((file) => /\.(tsx|ts|jsx|js|html|css|json)$/.test(file))
      .map((file) => {
        try {
          return harness.readFile(rootPath, file);
        } catch {
          return '';
        }
      })
      .join('\n')
  );
}

function assertTerms({ text = '', requiredTerms = [], forbiddenTerms = [], prefix = '' } = {}) {
  for (const term of requiredTerms) {
    const normalized = normalizeSmokeText(term);
    assert.ok(text.includes(normalized), `${prefix} should include required term: ${term}`);
  }
  for (const term of forbiddenTerms) {
    const normalized = normalizeSmokeText(term);
    assert.strictEqual(text.includes(normalized), false, `${prefix} should not include stale term: ${term}`);
  }
}

function applyDeterministicEdits(harness, rootPath, edits = []) {
  const applied = [];
  for (const edit of edits) {
    const projectInfo = harness.scanProject(rootPath);
    const patch = harness.deterministicService.buildContentEditOperationBatch({
      projectInfo,
      executionIntent: 'edit_project',
      userMessage: edit.message,
    });
    assert.ok(patch && patch.ok, `deterministic edit should be generated: ${edit.message}`);
    assert.strictEqual(patch.action.generatedBy, edit.expectedGenerator);
    assert.strictEqual(patch.action.safePatchEvidence.validation.ok, true);
    harness.applyOperations(rootPath, patch.action.operations);
    const generatedText = readGeneratedText(harness, rootPath);
    assertTerms({
      text: generatedText,
      requiredTerms: edit.requiredTerms || [],
      prefix: edit.message,
    });
    applied.push(patch.action.generatedBy);
  }
  return applied;
}

function buildVisualSmokeHtml(caseDef, {
  broken = false,
  iteration = 1,
  generatedText = '',
  editGenerators = [],
} = {}) {
  const staleTerms = (caseDef.expected.forbiddenTerms || []).map((term) => normalizeSmokeText(term));
  const requiredTerms = (caseDef.expected.requiredTerms || []).slice(0, 8);
  const sections = caseDef.visual.sections || [];
  const chips = caseDef.visual.chips || [];
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${caseDef.visual.title} · Faber loop</title>
  <style>
    :root { color-scheme: dark; --bg: #101114; --panel: #1b1d22; --line: rgba(255,255,255,.14); --accent: #34d399; --warn: #f59e0b; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: #f8fafc; font-family: Inter, system-ui, sans-serif; }
    main { min-height: 100vh; overflow-x: hidden; }
    .shell { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0 40px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
    nav, .chips { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; max-width: 100%; }
    nav { justify-content: flex-end; }
    nav span, .chip { display: inline-flex; max-width: 100%; border: 1px solid rgba(52,211,153,.4); border-radius: 999px; padding: 6px 10px; color: #bbf7d0; font-size: 12px; overflow-wrap: anywhere; }
    .chips { margin-top: 12px; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(280px, .9fr); gap: 18px; align-items: stretch; padding: 28px 0; }
    .hero h1 { margin: 0; font-size: clamp(34px, 6vw, 72px); line-height: .96; overflow-wrap: anywhere; letter-spacing: 0; }
    .hero p, .section p, .audit p { color: rgba(248,250,252,.72); line-height: 1.45; }
    .visual { min-width: 0; display: grid; gap: 10px; border: 1px solid var(--line); border-radius: 8px; background: linear-gradient(145deg, #20242b, #13151a); padding: 16px; }
    .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .metric { min-width: 0; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; background: rgba(255,255,255,.04); padding: 10px; }
    .metric strong { display: block; font-size: 20px; }
    .sections { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .section, .audit { min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 14px; }
    .section strong, .audit strong { display: block; overflow-wrap: anywhere; }
    .audit { margin-top: 12px; }
    form { display: grid; gap: 8px; }
    input, button { width: 100%; min-width: 0; border-radius: 8px; border: 1px solid var(--line); background: #111318; color: #f8fafc; padding: 10px; font: inherit; }
    button { background: rgba(52,211,153,.18); border-color: rgba(52,211,153,.45); font-weight: 800; }
    .loop-overflow-probe { width: ${broken ? '132vw' : '100%'}; height: 18px; border-radius: 999px; background: ${broken ? '#ef4444' : '#34d399'}; }
    #metrics { position: fixed; left: -9999px; top: -9999px; }
    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
      header { align-items: flex-start; flex-direction: column; }
      nav { width: 100%; justify-content: flex-start; }
      .metric-grid, .sections { grid-template-columns: 1fr; }
      .shell { width: min(100vw - 24px, 520px); padding-top: 18px; }
    }
  </style>
</head>
<body>
  <main>
    <div class="shell">
      <header>
        <strong>${caseDef.visual.title}</strong>
        <nav>${sections.slice(0, 5).map((section) => `<span>${section}</span>`).join('')}</nav>
      </header>
      <section class="hero">
        <div>
          <p>${caseDef.category} · loop ${iteration}</p>
          <h1>${caseDef.visual.title}</h1>
          <p>${caseDef.visual.subtitle}</p>
          <div class="chips">${chips.map((chip) => `<span class="chip">${chip}</span>`).join('')}</div>
        </div>
        <div class="visual">
          <strong>Contrato visual</strong>
          <div class="metric-grid">
            <div class="metric"><strong>${sections.length}</strong><span>secoes</span></div>
            <div class="metric"><strong>${caseDef.visual.hasCalculator ? 'sim' : 'nao'}</strong><span>calculadora</span></div>
            <div class="metric"><strong>${editGenerators.length}</strong><span>edicoes</span></div>
          </div>
          <div class="loop-overflow-probe" aria-label="overflow probe"></div>
          ${caseDef.visual.hasCalculator ? '<p>Formula e resultado auditaveis com campos numericos.</p>' : '<p>Fluxo visual com CTA, prova e cobertura do briefing.</p>'}
        </div>
      </section>
      <section class="sections">
        ${sections.map((section, index) => `
          <article class="section">
            <strong>${section}</strong>
            <p>${requiredTerms[index % Math.max(1, requiredTerms.length)] || caseDef.visual.subtitle}</p>
          </article>
        `).join('')}
      </section>
      <section class="audit">
        <strong>Auditoria do loop</strong>
        <p>Gerado, validado, editado e recapturado. Edicoes: ${editGenerators.join(', ') || 'sem edicao'}.</p>
        ${caseDef.visual.hasForm ? '<form><input aria-label="Nome" placeholder="Nome" /><input aria-label="Contato" placeholder="Contato" /><button type="button">Enviar</button></form>' : ''}
      </section>
    </div>
  </main>
  <pre id="metrics"></pre>
  <script>
    const normalizedBody = document.body.innerText.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    const staleTerms = ${JSON.stringify(staleTerms)};
    const rects = Array.from(document.querySelectorAll('.section, .visual, .audit')).map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    });
    const overflowRects = Array.from(document.querySelectorAll('.loop-overflow-probe, .section, .visual, .audit, nav, nav span, .chips, .chip')).map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    const elementOverflowX = Math.ceil(Math.max(0, ...overflowRects.map((rect) => Math.max(
      rect.right - window.innerWidth,
      -rect.left,
      rect.width - window.innerWidth
    ))));
    const overlaps = rects.flatMap((a, index) => rects.slice(index + 1).map((b) => {
      const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return xOverlap * yOverlap;
    })).filter((area) => area > 1);
    document.getElementById('metrics').textContent = JSON.stringify({
      title: document.title,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      elementOverflowX,
      hasElementOverflow: elementOverflowX > 1 || overflowRects.some((rect) => rect.left < -1 || rect.right > window.innerWidth + 1 || rect.width > window.innerWidth + 1),
      cardOverlapCount: overlaps.length,
      visibleTextBlocks: Array.from(document.querySelectorAll('h1,p,strong,button,input')).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.top < window.innerHeight;
      }).length,
      sectionCount: document.querySelectorAll('.section').length,
      formCount: document.querySelectorAll('form').length,
      calculatorCount: ${caseDef.visual.hasCalculator ? 1 : 0},
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((node) => node.innerText.trim()),
      buttons: Array.from(document.querySelectorAll('button')).map((node) => node.innerText.trim()),
      bodyText: normalizedBody.slice(0, 4000),
      hasForbiddenTerm: staleTerms.some((term) => normalizedBody.includes(term)),
      generatedHash: '${crypto.createHash('sha1').update(generatedText).digest('hex').slice(0, 12)}'
    });
  </script>
</body>
</html>`;
}

async function captureHtmlWithElectron({ electron, htmlPath, pngPath, viewport }) {
  const payloadPath = path.join(os.tmpdir(), `faber-full-tool-loop-${crypto.randomUUID()}-capture.json`);
  const metricsPath = path.join(os.tmpdir(), `faber-full-tool-loop-${crypto.randomUUID()}-metrics.json`);
  const errorPath = path.join(os.tmpdir(), `faber-full-tool-loop-${crypto.randomUUID()}-error.txt`);
  fs.writeFileSync(payloadPath, JSON.stringify({
    errorPath,
    htmlPath,
    metricsPath,
    pngPath,
    viewport,
  }), 'utf8');

  try {
    execFileSync(electron, [getElectronCaptureScriptPath(), payloadPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_FORCE_DEVICE_SCALE_FACTOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 12000,
    });
  } catch (error) {
    const detail = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : error.stderr || error.message;
    throw new Error(`Electron visual capture failed for ${viewport.id}: ${detail}`);
  }

  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  assert.strictEqual(metrics.innerWidth, viewport.width, `${viewport.id}: capture viewport should match requested width`);
  assert.strictEqual(metrics.electronContentWidth, viewport.width, `${viewport.id}: Electron content width should match requested width`);
  const analysis = analyzePng(pngPath);
  assert.strictEqual(analysis.width, viewport.width, `${viewport.id}: PNG width should match requested viewport`);
  assert.strictEqual(analysis.height, viewport.height, `${viewport.id}: PNG height should match requested viewport`);
  const issues = [];
  if (analysis.blankLikely) {
    issues.push({
      id: 'capture_blank',
      severity: 'error',
      detail: 'Captura do loop parece vazia.',
    });
  }
  if (metrics.hasHorizontalOverflow || metrics.hasElementOverflow) {
    issues.push({
      id: 'capture_horizontal_overflow',
      severity: 'error',
      detail: 'Captura do loop detectou overflow horizontal ou elemento fora do viewport.',
    });
  }
  if (metrics.cardOverlapCount) {
    issues.push({
      id: 'capture_card_overlap',
      severity: 'error',
      detail: 'Captura do loop detectou sobreposicao de cards.',
    });
  }
  if (metrics.hasForbiddenTerm) {
    issues.push({
      id: 'stale_context_visual_leak',
      severity: 'error',
      detail: 'Captura renderizada contem termo de contexto antigo.',
    });
  }

  return {
    ok: true,
    path: pngPath,
    viewport,
    metrics,
    analysis: {
      ...analysis,
      horizontalOverflow: metrics.hasHorizontalOverflow || metrics.hasElementOverflow,
      visibleTextBlocks: metrics.visibleTextBlocks,
    },
    pageSnapshot: {
      title: metrics.title,
      bodyText: metrics.bodyText,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        devicePixelRatio: 1,
      },
      layout: {
        scrollWidth: metrics.scrollWidth,
        clientWidth: metrics.clientWidth,
        elementOverflowX: Number(metrics.elementOverflowX || 0),
        overflowX: Math.max(0, metrics.scrollWidth - metrics.clientWidth, Number(metrics.elementOverflowX || 0)),
        horizontalOverflow: metrics.hasHorizontalOverflow || metrics.hasElementOverflow,
        visibleTextBlocks: metrics.visibleTextBlocks,
      },
      headings: metrics.headings,
      buttons: metrics.buttons,
      images: [],
      videos: [],
      iframes: [],
      svgCount: 0,
      iconLikeCount: 0,
      sectionCount: metrics.sectionCount,
      formCount: metrics.formCount,
      computedTokens: [],
    },
    issues,
  };
}

async function runVisualValidationLoop({
  artifactStore,
  caseDef,
  electron,
  generatedText,
  iteration,
  rootPath,
  variant,
  editGenerators,
}) {
  const broken = variant === 'broken';
  const htmlPath = path.join(os.tmpdir(), `faber-full-tool-loop-${caseDef.id}-${iteration}-${variant}.html`);
  fs.writeFileSync(htmlPath, buildVisualSmokeHtml(caseDef, {
    broken,
    iteration,
    generatedText,
    editGenerators,
  }), 'utf8');
  const fileUrl = `file://${htmlPath}`;
  const captures = [];
  const visualRuntime = createProjectVisualValidationRuntimeService({
    evaluateVisualBriefingSemantics: () => ({ enabled: false }),
    evaluateVisualProductCoverage: () => ({ enabled: false }),
    startProjectPreview: async () => ({
      ok: true,
      session: {
        status: 'ready',
        url: fileUrl,
        mode: 'static-smoke',
      },
    }),
    captureProjectPreview: async ({ viewport }) => {
      const pngPath = path.join(os.tmpdir(), `faber-full-tool-loop-${caseDef.id}-${iteration}-${variant}-${viewport.id}.png`);
      const capture = await captureHtmlWithElectron({
        electron,
        htmlPath,
        pngPath,
        viewport,
      });
      captures.push(capture);
      return capture;
    },
  });
  const report = await visualRuntime.runProjectVisualValidation(createProjectInfo(rootPath), {
    force: true,
    userMessage: caseDef.message,
    executionIntent: 'init_project',
    artifactContext: generatedText,
    action: {
      executionValidation: {
        score: 96,
        minScore: 55,
        technicalChecksPassed: true,
        artifactQuality: {
          enabled: true,
          score: 96,
          minScore: 70,
          passesMinimum: true,
          criticalFailures: [],
          issues: [],
        },
        visualValidation: {
          required: true,
        },
      },
    },
    captureOptions: {
      viewports: VIEWPORTS,
    },
  });
  const gate = visualRuntime.evaluateVisualValidationGate(report);

  const artifacts = captures.map((capture) => {
    const stored = artifactStore.storeArtifact({
      rootPath,
      sourcePath: capture.path,
      kind: 'visual-smoke',
      category: 'full-tool-loop',
      label: `${caseDef.id}-${iteration}-${variant}-${capture.viewport.id}`,
      metadata: {
        caseId: caseDef.id,
        iteration,
        variant,
        viewport: capture.viewport,
        metrics: capture.metrics,
      },
    });
    assert.strictEqual(stored.ok, true, `artifact store should persist ${capture.path}`);
    return stored.entry.relativePath;
  });

  return {
    artifacts,
    captures,
    gate,
    report,
  };
}

async function validateBlueprintContract({ caseDef, rootPath, blueprint, visual }) {
  const service = createFaberCapabilityAdapterService({
    fs,
    path,
    now: () => '2026-05-28T18:00:00.000Z',
  });
  const validation = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'validate',
    projectSession: {
      rootPath,
      projectId: `full-loop-${caseDef.id}`,
      projectName: `Full loop ${caseDef.id}`,
    },
    payload: {
      blueprint: blueprint.action,
      sourcePolicy: {
        requiredTerms: caseDef.expected.requiredTerms || [],
        forbiddenTerms: caseDef.expected.forbiddenTerms || [],
        allowedSources: ['current_briefing'],
        forbiddenSources: ['stale_active_memory'],
      },
      visualEvidence: {
        domMetrics: visual.captures.map((capture) => ({
          label: capture.viewport.id,
          innerWidth: capture.metrics.innerWidth,
          hamburgerVisible: capture.metrics.innerWidth < 1024,
          desktopNavVisible: capture.metrics.innerWidth >= 1024,
          hasHorizontalOverflow: capture.metrics.hasHorizontalOverflow || capture.metrics.hasElementOverflow,
          hasOldMemory: capture.metrics.hasForbiddenTerm,
        })),
        artifacts: visual.captures.map((capture) => capture.path),
      },
    },
  });
  assert.strictEqual(validation.ok, true);
  assert.strictEqual(validation.evidence.data.validation.gate, 'allow');
  assert.strictEqual(validation.evidence.data.validation.sourcePolicy.status, 'passed');
  assert.strictEqual(validation.evidence.data.validation.runtimeValidation.status, 'passed');
  return validation.evidence.data.validation;
}

async function runCase({ artifactStore, caseDef, electron, harness, iteration }) {
  const rootPath = harness.createScenarioRoot(`${caseDef.id}-${iteration}`);
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: caseDef.message,
    conversationMessages: caseDef.conversationMessages || [],
  });
  assert.strictEqual(route.decision, 'execute', `${caseDef.id}: route should execute`);
  assert.strictEqual(route.productRoute.capability, 'create_project', `${caseDef.id}: should create project`);

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, caseDef.mediaAssets || {});
  assert.strictEqual(blueprint.ok, true, `${caseDef.id}: blueprint should be ok`);

  if (caseDef.expected.domain) {
    assert.strictEqual(route.workingBrief.product.domain, caseDef.expected.domain);
    assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, caseDef.expected.domain);
  }
  if (caseDef.expected.domainPrefix) {
    assert.ok(
      route.workingBrief.product.domain.startsWith(caseDef.expected.domainPrefix),
      `${caseDef.id}: expected domain prefix ${caseDef.expected.domainPrefix}, got ${route.workingBrief.product.domain}`
    );
  }
  if (caseDef.expected.temporary) {
    assert.strictEqual(route.workingBrief.temporaryBlueprintContract.status, 'active');
    assert.strictEqual(blueprint.action.blueprint.moduleContract.status, 'temporary_contract_resolved');
  }
  if (caseDef.expected.recipe) {
    assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, caseDef.expected.recipe);
  }

  harness.applyOperations(rootPath, blueprint.action.operations);
  for (const relPath of caseDef.expected.requiredFiles || []) {
    assert.strictEqual(fileExists(rootPath, relPath), true, `${caseDef.id}: missing ${relPath}`);
  }

  let generatedText = readGeneratedText(harness, rootPath);
  assertTerms({
    text: generatedText,
    requiredTerms: caseDef.expected.requiredTerms || [],
    forbiddenTerms: caseDef.expected.forbiddenTerms || [],
    prefix: caseDef.id,
  });

  const editGenerators = applyDeterministicEdits(harness, rootPath, caseDef.edits || []);
  generatedText = readGeneratedText(harness, rootPath);

  if (caseDef.visual.repairProbe && iteration === 1) {
    const brokenVisual = await runVisualValidationLoop({
      artifactStore,
      caseDef,
      electron,
      generatedText,
      iteration,
      rootPath,
      variant: 'broken',
      editGenerators,
    });
    assert.strictEqual(brokenVisual.gate.shouldBlock, true, `${caseDef.id}: broken visual should block`);
    const brokenIssueSources = [
      ...(Array.isArray(brokenVisual.report.issues) ? brokenVisual.report.issues : []),
      ...brokenVisual.captures.flatMap((capture) => Array.isArray(capture.issues) ? capture.issues : []),
    ];
    const brokenOverflowCount = Number(
      brokenVisual.report &&
        brokenVisual.report.capture &&
        brokenVisual.report.capture.analysis
        ? brokenVisual.report.capture.analysis.horizontalOverflowViewportCount
        : 0
    );
    assert.ok(
      brokenIssueSources.some((issue) => issue.id === 'capture_horizontal_overflow') || brokenOverflowCount > 0,
      `${caseDef.id}: broken visual should report horizontal overflow`
    );
  }

  const fixedVisual = await runVisualValidationLoop({
    artifactStore,
    caseDef,
    electron,
    generatedText,
    iteration,
    rootPath,
    variant: 'fixed',
    editGenerators,
  });
  assert.strictEqual(fixedVisual.gate.shouldBlock, false, `${caseDef.id}: fixed visual should pass`);
  for (const capture of fixedVisual.captures) {
    assert.strictEqual(capture.analysis.blankLikely, false, `${caseDef.id}/${capture.viewport.id}: capture should not be blank`);
    assert.strictEqual(capture.metrics.hasHorizontalOverflow || capture.metrics.hasElementOverflow, false, `${caseDef.id}/${capture.viewport.id}: should not overflow`);
    assert.strictEqual(capture.metrics.cardOverlapCount, 0, `${caseDef.id}/${capture.viewport.id}: cards should not overlap`);
    assert.strictEqual(capture.metrics.sectionCount, caseDef.visual.sections.length);
  }

  const validation = await validateBlueprintContract({
    caseDef,
    rootPath,
    blueprint,
    visual: fixedVisual,
  });

  const listed = artifactStore.listArtifacts({ rootPath, category: 'full-tool-loop', limit: 20 });
  assert.strictEqual(listed.ok, true);
  assert.ok(listed.artifacts.length >= fixedVisual.captures.length);

  return {
    id: caseDef.id,
    iteration,
    domain: validation.moduleContract.domain,
    gate: validation.gate,
    edits: editGenerators,
    screenshots: fixedVisual.captures.map((capture) => capture.path),
    artifacts: fixedVisual.artifacts,
  };
}

async function run() {
  const electron = findElectron();
  assert.ok(electron, 'Electron is required for full tool loop smoke');
  const iterations = Math.max(1, Math.min(4, Number(process.env.FABER_TOOL_LOOP_ITERATIONS || 2)));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-full-tool-loop-'));
  const harness = createSmokeHarness(tempRoot);
  const artifactStore = createArtifactStoreService({
    crypto,
    fs,
    path,
    now: () => '2026-05-28T18:00:00.000Z',
  });
  const results = [];

  try {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      for (const caseDef of CASES) {
        results.push(await runCase({
          artifactStore,
          caseDef,
          electron,
          harness,
          iteration,
        }));
      }
    }
  } finally {
    if (process.env.FABER_KEEP_FULL_TOOL_LOOP_ARTIFACTS !== '1') {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  assert.strictEqual(results.length, iterations * CASES.length);
  console.log(`full-tool-loop-smoke.test.js: ok ${JSON.stringify({
    iterations,
    cases: CASES.length,
    screenshots: results.flatMap((result) => result.screenshots).slice(-12),
    gates: results.map((result) => result.gate),
  })}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
