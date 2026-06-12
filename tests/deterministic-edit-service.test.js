const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createDeterministicEditService,
  DETERMINISTIC_SAFE_PATCH_VALIDATION_SCHEMA_VERSION,
  extractBackgroundColor,
  extractCardTextEditIntent,
  extractCtaTextEditIntent,
  extractFaqItemPatchIntent,
  extractFormFieldPatchIntent,
  extractGridColumnsIntent,
  extractHeroMediaPatchIntent,
  extractLiteralColorReplacementIntent,
  extractNavLinkEditIntent,
  extractRequestedColor,
  extractRequestedTitle,
  extractSecondaryCtaEditIntent,
  extractSectionRemoveIntent,
  extractSectionReorderIntent,
  extractStatTextPatchIntent,
  extractSemanticColorEditIntent,
  extractTypographyIntent,
  isBackgroundColorEditRequest,
  isButtonColorEditRequest,
  isCardTextEditRequest,
  isCtaTextEditRequest,
  isFaqItemPatchRequest,
  isFooterInsertRequest,
  isFormFieldPatchRequest,
  isGridColumnsEditRequest,
  isHeroMediaPatchRequest,
  isHeadingColorEditRequest,
  isHydrationMismatchRepairRequest,
  isLiteralColorReplacementRequest,
  isNavLinkEditRequest,
  isSecondaryCtaEditRequest,
  isSectionRemoveRequest,
  isSectionReorderRequest,
  isStatTextPatchRequest,
  isThemeColorEditRequest,
  isTypographyEditRequest,
  replaceLiteralColor,
  updateTitleContent,
} = require('../main/services/deterministic_edit_service');
const {
  buildDeterministicEditPatchCheckpoint,
  buildDeterministicEditPatchEventPayload,
  DETERMINISTIC_EDIT_PATCH_EVIDENCE_SCHEMA_VERSION,
} = require('../main/services/deterministic_edit_patch_evidence_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function run() {
  assert.strictEqual(
    extractRequestedTitle('Mude o título da página já desenvolvida para "ESSE É UM TESTE DE ALTERAÇÃO"'),
    'ESSE É UM TESTE DE ALTERAÇÃO'
  );
  assert.strictEqual(extractRequestedTitle('mude a cor do botão para verde'), '');
  assert.strictEqual(
    extractRequestedTitle('Coloque uma imagem com overlay preto de 10% no fundo do topo para dar pra ver melhor o título H1'),
    ''
  );
  assert.strictEqual(
    extractRequestedTitle('troque a cor do H1 para o mesmo azul dos outros pontos do site'),
    ''
  );
  assert.strictEqual(isHeadingColorEditRequest('troque a cor do H1 para o mesmo azul dos outros pontos do site'), true);
  assert.strictEqual(extractRequestedColor('o vermelho pode ser esse: #cf416b'), '#cf416b');
  assert.strictEqual(extractRequestedColor('botão vermelho coral'), '#cf416b');
  assert.deepStrictEqual(
    extractLiteralColorReplacementIntent('Quero alterar as cores aonde for #257066 por um azul, a cor #4293c2'),
    {
      kind: 'literal_color_replacement',
      from: '#257066',
      to: '#4293c2',
    }
  );
  assert.strictEqual(
    isLiteralColorReplacementRequest('Quero alterar as cores aonde for #257066 por um azul, a cor #4293c2'),
    true
  );
  assert.strictEqual(
    isLiteralColorReplacementRequest('Troque todas as ocorrências de azul por #a81686 e a cor do fundo por #fcf7e3'),
    false
  );
  assert.deepStrictEqual(
    extractSemanticColorEditIntent('Troque todas as ocorrências do azul e do vermelho para #102A56.').sourceFamilies,
    ['red', 'blue']
  );
  assert.strictEqual(
    extractSemanticColorEditIntent('Troque todas as ocorrências do azul e do vermelho para #102A56.').targetColor,
    '#102a56'
  );
  assert.strictEqual(extractBackgroundColor('troque a cor do fundo por #fcf7e3'), '#fcf7e3');
  assert.strictEqual(extractBackgroundColor('Quero deixar o background do site vermelho'), '#cf416b');
  assert.strictEqual(isBackgroundColorEditRequest('Quero deixar o background do site vermelho'), true);
  assert.strictEqual(isBackgroundColorEditRequest('Coloque uma imagem com overlay preto no fundo do topo'), false);
  assert.strictEqual(isTypographyEditRequest('troque as tipografias para Playfair Display nos títulos e Cormorant nos textos'), true);
  assert.deepStrictEqual(
    extractTypographyIntent('troque as tipografias para Playfair Display nos títulos e Cormorant nos textos'),
    {
      titleFamily: 'Playfair Display',
      bodyFamily: 'Cormorant',
      families: ['Playfair Display', 'Cormorant'],
    }
  );
  assert.deepStrictEqual(replaceLiteralColor('color:#257066; border:#257066;', '#257066', '#4293c2'), {
    changed: true,
    content: 'color:#4293c2; border:#4293c2;',
    count: 2,
  });
  assert.strictEqual(isButtonColorEditRequest('Quero ajustar a cor do botão do topo para um botão vermelho coral'), true);
  assert.strictEqual(isThemeColorEditRequest('Troque as cores de verde para esse azul #3240a8'), true);
  assert.strictEqual(isFooterInsertRequest('Insira um Rodapé no site com cor contrastante'), true);
  assert.strictEqual(isHydrationMismatchRepairRequest('Erro hydration mismatch com cz-shortcut-listen no body'), true);
  assert.strictEqual(isSecondaryCtaEditRequest('Troque o texto do CTA secundário de Conhecer serviços para Ver planos'), true);
  assert.deepStrictEqual(
    extractSecondaryCtaEditIntent('Troque o texto do CTA secundário de Conhecer serviços para Ver planos'),
    { fromText: 'Conhecer serviços', toText: 'Ver planos', toHref: '', index: 1 }
  );
  assert.strictEqual(isCtaTextEditRequest('Troque o href do CTA primário para /contato'), true);
  assert.deepStrictEqual(extractCtaTextEditIntent('Troque o href do CTA primário para /contato'), {
    fromText: '',
    toText: '',
    toHref: '/contato',
    index: 0,
  });
  assert.strictEqual(isCardTextEditRequest('Troque o texto do segundo card para Consultoria premium'), true);
  assert.deepStrictEqual(extractCardTextEditIntent('Troque o texto do segundo card para Consultoria premium'), {
    index: 1,
    fromText: '',
    field: 'title',
    text: 'Consultoria premium',
  });
  assert.strictEqual(isGridColumnsEditRequest('Mude o grid de serviços para 3 colunas no desktop'), true);
  assert.deepStrictEqual(extractGridColumnsIntent('Mude o grid de serviços para 3 colunas no desktop'), {
    count: 3,
    breakpoint: 'lg',
    sectionId: 'servicos',
  });
  assert.strictEqual(isSectionReorderRequest('Mova a seção FAQ para antes da seção Depoimentos'), true);
  assert.deepStrictEqual(extractSectionReorderIntent('Mova a seção FAQ para antes da seção Depoimentos'), {
    sourceId: 'faq',
    targetId: 'depoimentos',
    position: 'before',
  });
  assert.strictEqual(isFaqItemPatchRequest('Adicione FAQ pergunta "Como funciona?" resposta "Em etapas."'), true);
  assert.strictEqual(extractFaqItemPatchIntent('Adicione FAQ pergunta "Como funciona?" resposta "Em etapas."').action, 'add');
  assert.strictEqual(isNavLinkEditRequest('Troque o link do menu de Blog para /insights'), true);
  assert.strictEqual(extractNavLinkEditIntent('Troque o link do menu de Blog para /insights').toHref, '/insights');
  assert.strictEqual(isSectionRemoveRequest('Remova a seção FAQ'), true);
  assert.deepStrictEqual(extractSectionRemoveIntent('Remova a seção FAQ'), { sectionId: 'faq' });
  assert.strictEqual(isFormFieldPatchRequest('Adicione campo WhatsApp ao formulário'), true);
  assert.strictEqual(extractFormFieldPatchIntent('Adicione campo WhatsApp ao formulário').type, 'tel');
  assert.strictEqual(isStatTextPatchRequest('Troque a métrica de 120 para 250'), true);
  assert.deepStrictEqual(extractStatTextPatchIntent('Troque a métrica de 120 para 250'), { fromText: '120', toText: '250' });
  assert.strictEqual(isHeroMediaPatchRequest('Troque o poster do vídeo hero para /hero-poster.jpg'), true);
  assert.deepStrictEqual(extractHeroMediaPatchIntent('Troque o poster do vídeo hero para /hero-poster.jpg'), {
    attr: 'poster',
    value: '/hero-poster.jpg',
    mediaKind: 'video',
  });

  const htmlResult = updateTitleContent(
    '<html><head><title>Antigo</title></head><body><h1>Título antigo</h1></body></html>',
    'Novo título',
    'index.html'
  );
  assert.strictEqual(htmlResult.changed, true);
  assert.ok(htmlResult.content.includes('<title>Novo título</title>'));
  assert.ok(htmlResult.content.includes('<h1>Novo título</h1>'));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-deterministic-edit-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, 'app', 'page.tsx'),
      [
        'export default function Page() {',
        '  return <main><h1>Uma presença digital clara para transformar visitantes em contatos.</h1></main>;',
        '}',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'app', 'layout.tsx'),
      "export const metadata = { title: 'Faber Projeto' };\nexport default function Layout({children}) { return <html><body>{children}</body></html>; }\n",
      'utf8'
    );

    const service = createDeterministicEditService({
      fs,
      path,
      buildOperationBatchDiffPreview,
    });
    assert.strictEqual(
      service.isSectionBackgroundFullWidthRequest('na segunda sessão do body o degradê do fundo precisa estar full width, está limitado como pode ver no anexo'),
      true
    );
    assert.deepStrictEqual(service.classifySafeContentEditRequest('Quero deixar o background do site vermelho'), {
      schemaVersion: 'deterministic-safe-patch-classification-v1',
      supported: true,
      kind: 'background_color_micro_patch',
      color: '#cf416b',
      reason: 'Pedido contém alvo de fundo/background e uma cor resolvida para micro-patch determinístico.',
    });
    assert.strictEqual(
      service.classifySafeContentEditRequest('Corrija o hydration mismatch causado por cz-shortcut-listen no body').kind,
      'hydration_mismatch_micro_patch'
    );
    assert.strictEqual(
      service.classifySafeContentEditRequest('Insira um Rodapé no site com a cor #fcf7e3').kind,
      'footer_insert_micro_patch'
    );
    const unsafeBackground = service.classifySafeContentEditRequest(
      'Coloque uma imagem com overlay preto de 10% no fundo do topo para dar pra ver melhor o título H1'
    );
    assert.strictEqual(unsafeBackground.supported, false);
    assert.strictEqual(unsafeBackground.kind, 'background_media_overlay_requires_visual_patch');

    const result = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 2,
        files: ['app/page.tsx', 'app/layout.tsx'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Mude o título da página já desenvolvida para "ESSE É UM TESTE DE ALTERAÇÃO"',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.action.generatedBy, 'deterministic_title_edit_patch');
    assert.strictEqual(result.action.safePatchEvidence.schemaVersion, DETERMINISTIC_EDIT_PATCH_EVIDENCE_SCHEMA_VERSION);
    assert.strictEqual(result.action.safePatchEvidence.status, 'approved');
    assert.strictEqual(result.action.safePatchEvidence.generator, 'deterministic_title_edit_patch');
    assert.strictEqual(result.action.safePatchEvidence.classification.kind, 'title_micro_patch');
    assert.strictEqual(result.action.safePatchEvidence.validation.ok, true);
    const titlePatchCheckpoint = buildDeterministicEditPatchCheckpoint(result.action);
    assert.strictEqual(titlePatchCheckpoint.status, 'approved');
    assert.deepStrictEqual(titlePatchCheckpoint.files, ['app/page.tsx', 'app/layout.tsx']);
    const titlePatchEvent = buildDeterministicEditPatchEventPayload(titlePatchCheckpoint);
    assert.strictEqual(titlePatchEvent.kind, 'title_micro_patch');
    assert.strictEqual(titlePatchEvent.validationOk, true);
    assert.strictEqual(titlePatchEvent.operationsCount, 2);
    assert.deepStrictEqual(result.action.operations.map((operation) => operation.path), [
      'app/page.tsx',
      'app/layout.tsx',
    ]);
    assert.ok(result.action.operations[0].content.includes('<h1>ESSE É UM TESTE DE ALTERAÇÃO</h1>'));
    assert.ok(result.action.operations[1].content.includes("title: 'ESSE É UM TESTE DE ALTERAÇÃO'"));

    const hydration = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 2,
        files: ['app/page.tsx', 'app/layout.tsx'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Corrija o hydration mismatch causado por cz-shortcut-listen no body',
    });
    assert.strictEqual(hydration.ok, true);
    assert.strictEqual(hydration.action.generatedBy, 'deterministic_next_hydration_patch');
    assert.ok(hydration.action.operations[0].content.includes('<body suppressHydrationWarning>'));

    fs.writeFileSync(
      path.join(tempRoot, 'app', 'page.tsx'),
      [
        'export default function Page() {',
        '  return <main><section id="inicio"><a className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" href="#contato">Agendar conversa</a></section></main>;',
        '}',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'app', 'globals.css'),
      ':root { --color-accent: #2f8f83; --color-accent-dark: #18675f; --color-line: rgba(0,0,0,.1); --color-ink: #1f2424; }',
      'utf8'
    );
    const colorPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Quero ajustar a cor do botão do topo para um botão vermelho coral #cf416b',
    });
    assert.strictEqual(colorPatch.ok, true);
    assert.strictEqual(colorPatch.action.generatedBy, 'deterministic_button_color_patch');
    assert.strictEqual(colorPatch.action.safePatchValidation.schemaVersion, DETERMINISTIC_SAFE_PATCH_VALIDATION_SCHEMA_VERSION);
    assert.strictEqual(colorPatch.action.safePatchValidation.ok, true);
    assert.strictEqual(colorPatch.action.safePatchEvidence.operationsCount, 1);
    assert.strictEqual(colorPatch.action.safePatchEvidence.changedFiles[0].path, 'app/page.tsx');
    assert.ok(colorPatch.action.operations[0].content.includes('bg-[#cf416b]'));

    const themePatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Troque as cores de verde para esse azul #3240a8',
    });
    assert.strictEqual(themePatch.ok, true);
    assert.strictEqual(themePatch.action.generatedBy, 'deterministic_global_style_patch');
    assert.ok(themePatch.action.operations[0].content.includes('--color-accent: #3240a8;'));
    assert.ok(themePatch.action.operations[0].content.includes('--color-accent-dark: #2a368d;'));

    fs.writeFileSync(
      path.join(tempRoot, 'app', 'page.tsx'),
      [
        'export default function Page() {',
        '  return <main><a className="bg-blue-700 text-red-700">CTA</a><span className="text-[var(--color-accent)]">texto</span></main>;',
        '}',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempRoot, 'app', 'globals.css'),
      [
        '@import "tailwindcss";',
        ':root { --color-bg: #f7f4ec; --color-accent: #183b73; --color-accent-dark: #132e5a; --danger: #a81625; }',
        'body { margin: 0; background: var(--color-bg); font-family: "Manrope", sans-serif; }',
      ].join('\n'),
      'utf8'
    );
    const globalColorPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Quero alterar todas as ocorrências do azul e do vermelho para #102A56.',
    });
    assert.strictEqual(globalColorPatch.ok, true);
    assert.strictEqual(globalColorPatch.action.generatedBy, 'deterministic_global_style_patch');
    assert.ok(globalColorPatch.action.operations.find((operation) => operation.path === 'app/page.tsx').content.includes('bg-[#102a56]'));
    assert.ok(globalColorPatch.action.operations.find((operation) => operation.path === 'app/globals.css').content.includes('--color-accent: #102a56;'));
    assert.ok(globalColorPatch.action.operations.find((operation) => operation.path === 'app/globals.css').content.includes('--danger: #102a56;'));

    const globalTypographyPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Troque a cor do fundo por #fcf7e3, e troque todas as tipografias para Playfair Display nos títulos e Cormorant nos textos',
    });
    assert.strictEqual(globalTypographyPatch.ok, true);
    assert.strictEqual(globalTypographyPatch.action.generatedBy, 'deterministic_global_style_patch');
    const globalTypographyCss = globalTypographyPatch.action.operations.find((operation) => operation.path === 'app/globals.css').content;
    assert.ok(globalTypographyCss.includes('--color-bg: #fcf7e3;'));
    assert.ok(globalTypographyCss.includes('fonts.googleapis.com'));
    assert.ok(globalTypographyCss.includes('font-family: "Cormorant"'));
    assert.ok(globalTypographyCss.includes('h1, h2, h3, .font-display'));
    assert.ok(globalTypographyCss.includes('font-family: "Playfair Display"'));

    const lampRoot = path.join(tempRoot, 'lamp-site');
    fs.mkdirSync(path.join(lampRoot, 'assets', 'css'), { recursive: true });
    fs.writeFileSync(
      path.join(lampRoot, 'assets', 'css', 'styles-v2.css'),
      [
        ':root {',
        '  --paper: #f8f7f2;',
        '  --ink: #222222;',
        '}',
        'body { background: var(--paper); color: var(--ink); }',
      ].join('\n'),
      'utf8'
    );
    const lampBackgroundPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: lampRoot,
        totalFiles: 2,
        files: ['index.html', 'assets/css/styles-v2.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Quero deixar o background do site vermelho',
    });
    assert.strictEqual(lampBackgroundPatch.ok, true);
    assert.strictEqual(lampBackgroundPatch.action.generatedBy, 'deterministic_global_style_patch');
    assert.strictEqual(lampBackgroundPatch.action.safePatchClassification.kind, 'background_color_micro_patch');
    assert.strictEqual(lampBackgroundPatch.action.safePatchValidation.ok, true);
    assert.strictEqual(lampBackgroundPatch.action.operations[0].path, 'assets/css/styles-v2.css');
    assert.ok(lampBackgroundPatch.action.operations[0].content.includes('--paper: #cf416b;'));

    const noBackgroundTargetRoot = path.join(tempRoot, 'no-background-target');
    fs.mkdirSync(path.join(noBackgroundTargetRoot, 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(noBackgroundTargetRoot, 'app', 'globals.css'),
      ':root { --color-accent: #2f8f83; --color-accent-dark: #18675f; }',
      'utf8'
    );
    const backgroundWithoutTargetPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: noBackgroundTargetRoot,
        totalFiles: 1,
        files: ['app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Troque a cor do fundo por #fcf7e3',
    });
    assert.strictEqual(
      backgroundWithoutTargetPatch,
      null,
      'background request must not fall back to theme/accent patch when no background target exists'
    );

    fs.writeFileSync(
      path.join(tempRoot, 'app', 'page.tsx'),
      [
        'export default function Page() {',
        '  return <main><h1 className="max-w-4xl text-6xl font-black leading-none text-white">Estratégia jurídica para proteger marcas.</h1></main>;',
        '}',
      ].join('\n'),
      'utf8'
    );
    const headingColorPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'troque a cor do H1 para o mesmo azul dos outros pontos do site',
    });
    assert.strictEqual(headingColorPatch.ok, true);
    assert.strictEqual(headingColorPatch.action.generatedBy, 'deterministic_heading_color_patch');
    const headingColorPage = headingColorPatch.action.operations[0].content;
    assert.ok(headingColorPage.includes('text-[var(--color-accent)]'));
    assert.ok(headingColorPage.includes('text-6xl'));
    assert.ok(headingColorPage.includes('Estratégia jurídica para proteger marcas.'));
    assert.ok(!headingColorPage.includes('text-white'));

    const mediaOverlayPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Coloque uma imagem com overlay preto de 10% no fundo do topo para dar pra ver melhor o título H1',
    });
    assert.strictEqual(mediaOverlayPatch, null);

    fs.writeFileSync(
      path.join(tempRoot, 'app', 'globals.css'),
      ':root { --color-accent: #257066; --color-accent-dark: #257066; --color-line: #257066; }',
      'utf8'
    );
    const literalColorPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Quero alterar as cores aonde for #257066 por um azul, a cor #4293c2',
    });
    assert.strictEqual(literalColorPatch.ok, true);
    assert.strictEqual(literalColorPatch.action.generatedBy, 'micro_color_literal_replace_patch');
    assert.strictEqual(literalColorPatch.action.microContract.schemaVersion, 'micro-edit-color-replacement-v1');
    assert.strictEqual(literalColorPatch.action.safePatchValidation.ok, true);
    assert.strictEqual(literalColorPatch.action.safePatchEvidence.microContract.schemaVersion, 'micro-edit-color-replacement-v1');
    assert.strictEqual(literalColorPatch.action.safePatchEvidence.microContract.type, 'literal_color_replacement');
    assert.ok(literalColorPatch.action.operations[0].content.includes('--color-accent: #4293c2;'));
    assert.ok(!literalColorPatch.action.operations[0].content.includes('#257066'));

    const footerPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Insira um Rodapé no site com a cor #fcf7e3, ícones e redes sociais',
    });
    assert.strictEqual(footerPatch.ok, true);
    assert.strictEqual(footerPatch.action.generatedBy, 'deterministic_footer_insert_patch');
    assert.strictEqual(footerPatch.action.safePatchClassification.kind, 'footer_insert_micro_patch');
    assert.strictEqual(footerPatch.action.safePatchValidation.ok, true);
    assert.ok(footerPatch.action.operations[0].content.includes('<footer className='));
    assert.ok(footerPatch.action.operations[0].content.includes('bg-[#fcf7e3]'));
    assert.ok(footerPatch.action.operations[0].content.includes('Instagram'));

    const structuralFixture = [
      'export default function Page() {',
      '  return (',
      '    <>',
      '      <header><nav><a href="/">Início</a><a href="/blog">Blog</a></nav></header>',
      '      <main>',
      '      <section id="hero">',
      '        <img src="/hero-old.jpg" alt="Hero antigo" />',
      '        <video poster="/poster-old.jpg"><source src="/video-old.mp4" /></video>',
      '        <a href="#contato">Agendar conversa</a>',
      '        <a href="#servicos">Conhecer serviços</a>',
      '      </section>',
      '      <section id="servicos">',
      '        <div className="grid md:grid-cols-2 gap-6">',
      '          <article><h3>Diagnóstico Faber</h3><p>Mapeamento.</p></article>',
      '          <article><h3>Implantação guiada</h3><p>Execução.</p></article>',
      '        </div>',
      '      </section>',
      '      <section id="metricas"><h2>Métricas</h2><strong>120</strong><span>Clientes ativos</span></section>',
      '      <section id="depoimentos"><h2>Depoimentos</h2></section>',
      '      <section id="faq"><h2>FAQ</h2><article><h3>Como funciona?</h3><p>Em etapas.</p></article></section>',
      '      <section id="contato"><h2>Contato</h2><form><label><span>Nome</span><input name="nome" type="text" placeholder="Nome" /></label></form></section>',
      '      </main>',
      '    </>',
      '  );',
      '}',
    ].join('\n');

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const structuralProjectInfo = {
      rootPath: tempRoot,
      totalFiles: 3,
      files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
    };

    const secondaryCtaPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque o texto do CTA secundário de Conhecer serviços para Ver planos',
    });
    assert.strictEqual(secondaryCtaPatch.ok, true);
    assert.strictEqual(secondaryCtaPatch.action.generatedBy, 'deterministic_cta_text_patch');
    assert.strictEqual(secondaryCtaPatch.action.safePatchClassification.kind, 'cta_text_micro_patch');
    assert.strictEqual(secondaryCtaPatch.action.safePatchValidation.ok, true);
    assert.ok(secondaryCtaPatch.action.operations[0].content.includes('>Ver planos</a>'));
    assert.ok(!secondaryCtaPatch.action.operations[0].content.includes('>Conhecer serviços</a>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const primaryCtaHrefPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque o href do CTA primário para /contato',
    });
    assert.strictEqual(primaryCtaHrefPatch.ok, true);
    assert.strictEqual(primaryCtaHrefPatch.action.generatedBy, 'deterministic_cta_text_patch');
    assert.ok(primaryCtaHrefPatch.action.operations[0].content.includes('<a href="/contato">Agendar conversa</a>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const cardTextPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque o texto do segundo card para Consultoria premium',
    });
    assert.strictEqual(cardTextPatch.ok, true);
    assert.strictEqual(cardTextPatch.action.generatedBy, 'deterministic_card_text_patch');
    assert.strictEqual(cardTextPatch.action.safePatchClassification.kind, 'card_text_micro_patch');
    assert.ok(cardTextPatch.action.operations[0].content.includes('<article><h3>Consultoria premium</h3><p>Execução.</p></article>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const gridColumnsPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Mude o grid de serviços para 3 colunas no desktop',
    });
    assert.strictEqual(gridColumnsPatch.ok, true);
    assert.strictEqual(gridColumnsPatch.action.generatedBy, 'deterministic_grid_columns_patch');
    assert.strictEqual(gridColumnsPatch.action.safePatchClassification.kind, 'grid_columns_micro_patch');
    assert.ok(gridColumnsPatch.action.operations[0].content.includes('className="grid lg:grid-cols-3 gap-6"'));

    fs.writeFileSync(
      path.join(tempRoot, 'style.css'),
      '.section { width: 100%; max-width: 1180px; margin: 0 auto; }\n.intro-band { background: linear-gradient(180deg, transparent, rgba(241,204,152,.2)); }\n.closing-cta { max-width: none; background: linear-gradient(180deg, rgba(248,247,242,.96), rgba(241,204,152,.26)); }\n',
      'utf8'
    );
    const sectionBackgroundWidthPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['index.html', 'style.css', 'script.js'],
      },
      executionIntent: 'edit_project',
      userMessage: 'na segunda sessão do body o degradê do fundo precisa estar full width, está limitado como pode ver no anexo',
      attachments: [{ name: 'Screenshot 2026-05-29.png', type: 'image/png' }],
    });
    assert.strictEqual(sectionBackgroundWidthPatch.ok, true);
    assert.strictEqual(sectionBackgroundWidthPatch.action.generatedBy, 'deterministic_section_background_width_patch');
    assert.strictEqual(sectionBackgroundWidthPatch.action.safePatchClassification.kind, 'section_background_width_micro_patch');
    assert.ok(sectionBackgroundWidthPatch.action.operations[0].content.includes('.intro-band { max-width: none;'));
    assert.ok(sectionBackgroundWidthPatch.action.operations[0].content.includes('.intro-band > .card-grid'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const sectionReorderPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Mova a seção FAQ para antes da seção Depoimentos',
    });
    assert.strictEqual(sectionReorderPatch.ok, true);
    assert.strictEqual(sectionReorderPatch.action.generatedBy, 'deterministic_section_reorder_patch');
    assert.strictEqual(sectionReorderPatch.action.safePatchClassification.kind, 'section_reorder_micro_patch');
    assert.ok(
      sectionReorderPatch.action.operations[0].content.indexOf('id="faq"') <
        sectionReorderPatch.action.operations[0].content.indexOf('id="depoimentos"')
    );

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const faqAddPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Adicione FAQ pergunta "Tem suporte?" resposta "Sim, com acompanhamento."',
    });
    assert.strictEqual(faqAddPatch.ok, true);
    assert.strictEqual(faqAddPatch.action.generatedBy, 'deterministic_faq_item_patch');
    assert.strictEqual(faqAddPatch.action.safePatchClassification.kind, 'faq_item_micro_patch');
    assert.ok(faqAddPatch.action.operations[0].content.includes('<h3>Tem suporte?</h3>'));
    assert.ok(faqAddPatch.action.operations[0].content.includes('<p>Sim, com acompanhamento.</p>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const faqEditPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Edite a resposta da pergunta "Como funciona?" para "Em três etapas guiadas."',
    });
    assert.strictEqual(faqEditPatch.ok, true);
    assert.ok(faqEditPatch.action.operations[0].content.includes('<p>Em três etapas guiadas.</p>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const faqRemovePatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Remova FAQ pergunta "Como funciona?"',
    });
    assert.strictEqual(faqRemovePatch.ok, true);
    assert.ok(!faqRemovePatch.action.operations[0].content.includes('<h3>Como funciona?</h3>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const navLinkPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque o link do menu de Blog para /insights',
    });
    assert.strictEqual(navLinkPatch.ok, true);
    assert.strictEqual(navLinkPatch.action.generatedBy, 'deterministic_nav_link_patch');
    assert.ok(navLinkPatch.action.operations[0].content.includes('<a href="/insights">Blog</a>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const sectionRemovePatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Remova a seção FAQ',
    });
    assert.strictEqual(sectionRemovePatch.ok, true);
    assert.strictEqual(sectionRemovePatch.action.generatedBy, 'deterministic_section_remove_patch');
    assert.ok(!sectionRemovePatch.action.operations[0].content.includes('id="faq"'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const formAddPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Adicione campo WhatsApp ao formulário',
    });
    assert.strictEqual(formAddPatch.ok, true);
    assert.strictEqual(formAddPatch.action.generatedBy, 'deterministic_form_field_patch');
    assert.ok(formAddPatch.action.operations[0].content.includes('<span>WhatsApp</span>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const formRenamePatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Renomeie campo Nome para Nome completo',
    });
    assert.strictEqual(formRenamePatch.ok, true);
    assert.ok(formRenamePatch.action.operations[0].content.includes('<span>Nome completo</span>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const statPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque a métrica de 120 para 250',
    });
    assert.strictEqual(statPatch.ok, true);
    assert.strictEqual(statPatch.action.generatedBy, 'deterministic_stat_text_patch');
    assert.ok(statPatch.action.operations[0].content.includes('<strong>250</strong>'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const heroMediaPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque o poster do vídeo hero para /hero-poster.jpg',
    });
    assert.strictEqual(heroMediaPatch.ok, true);
    assert.strictEqual(heroMediaPatch.action.generatedBy, 'deterministic_hero_media_patch');
    assert.ok(heroMediaPatch.action.operations[0].content.includes('<video poster="/hero-poster.jpg">'));

    const heroVideoOverlayPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage:
        'Precisamos ajustar o hero do topo do body, colocar um vídeo de abelhas voando e uma camada branca com blend cor',
    });
    assert.strictEqual(heroVideoOverlayPatch, null);
    const heroVideoOverlayClassification = service.classifySafeContentEditRequest(
      'Precisamos ajustar o hero do topo do body, colocar um vídeo de abelhas voando e uma camada branca com blend cor'
    );
    assert.strictEqual(heroVideoOverlayClassification.supported, false);
    assert.strictEqual(heroVideoOverlayClassification.kind, 'background_media_overlay_requires_visual_patch');

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const heroImageSrcPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque o src da imagem hero para /hero-new.jpg',
    });
    assert.strictEqual(heroImageSrcPatch.ok, true);
    assert.ok(heroImageSrcPatch.action.operations[0].content.includes('<img src="/hero-new.jpg" alt="Hero antigo" />'));

    fs.writeFileSync(path.join(tempRoot, 'app', 'page.tsx'), structuralFixture, 'utf8');
    const heroImageAltPatch = service.buildContentEditOperationBatch({
      projectInfo: structuralProjectInfo,
      executionIntent: 'edit_project',
      userMessage: 'Troque o alt da imagem hero para "Nova imagem institucional"',
    });
    assert.strictEqual(heroImageAltPatch.ok, true);
    assert.ok(heroImageAltPatch.action.operations[0].content.includes('alt="Nova imagem institucional"'));

    const unsafeValidation = service.validateSafePatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      userMessage: 'Patch malicioso',
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        generatedBy: 'deterministic_title_edit_patch',
        operations: [
          { op: 'write_file', path: '../outside.tsx', content: 'export default null;' },
          { op: 'mkdir', path: 'app/new-folder' },
        ],
      },
    });
    assert.strictEqual(unsafeValidation.ok, false);
    assert.ok(unsafeValidation.errors.some((entry) => entry.reason === 'unsafe_or_invalid_path'));
    assert.ok(unsafeValidation.errors.some((entry) => entry.reason === 'unsupported_operation_for_safe_patch'));

    const suspiciousPatch = service.validateSafePatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      userMessage: 'Patch suspeito',
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        generatedBy: 'deterministic_title_edit_patch',
        operations: [
          {
            op: 'write_file',
            path: 'app/page.tsx',
            content: 'export default function Page() { eval("alert(1)"); return <main />; }',
          },
        ],
      },
    });
    assert.strictEqual(suspiciousPatch.ok, false);
    assert.ok(suspiciousPatch.errors.some((entry) => entry.reason === 'safe_patch_introduces_suspicious_code'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('deterministic-edit-service.test.js: ok');
}

run();
