const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createDeterministicEditService,
  extractRequestedColor,
  extractRequestedTitle,
  isButtonColorEditRequest,
  isFooterInsertRequest,
  isHydrationMismatchRepairRequest,
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
  assert.strictEqual(extractRequestedColor('o vermelho pode ser esse: #cf416b'), '#cf416b');
  assert.strictEqual(extractRequestedColor('botão vermelho coral'), '#cf416b');
  assert.strictEqual(isButtonColorEditRequest('Quero ajustar a cor do botão do topo para um botão vermelho coral'), true);
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

    const footerPatch = service.buildContentEditOperationBatch({
      projectInfo: {
        rootPath: tempRoot,
        totalFiles: 3,
        files: ['app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      },
      executionIntent: 'edit_project',
      userMessage: 'Insira um Rodapé no site com a cor contrastante do fundo claro',
    });
    assert.strictEqual(footerPatch.ok, true);
    assert.strictEqual(footerPatch.action.generatedBy, 'deterministic_footer_insert_patch');
    assert.ok(footerPatch.action.operations[0].content.includes('<footer className='));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('deterministic-edit-service.test.js: ok');
}

run();
