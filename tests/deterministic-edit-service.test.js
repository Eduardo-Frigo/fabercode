const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createDeterministicEditService,
  extractBackgroundColor,
  extractLiteralColorReplacementIntent,
  extractRequestedColor,
  extractRequestedTitle,
  extractSemanticColorEditIntent,
  extractTypographyIntent,
  isButtonColorEditRequest,
  isFooterInsertRequest,
  isHeadingColorEditRequest,
  isHydrationMismatchRepairRequest,
  isLiteralColorReplacementRequest,
  isThemeColorEditRequest,
  isTypographyEditRequest,
  replaceLiteralColor,
  updateTitleContent,
} = require('../main/services/deterministic_edit_service');

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
    assert.ok(footerPatch.action.operations[0].content.includes('<footer className='));
    assert.ok(footerPatch.action.operations[0].content.includes('bg-[#fcf7e3]'));
    assert.ok(footerPatch.action.operations[0].content.includes('Instagram'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('deterministic-edit-service.test.js: ok');
}

run();
