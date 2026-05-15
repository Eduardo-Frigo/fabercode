const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  createArtifactQualityService,
  inferArtifactExpectations,
  isNarrowContentEditRequest,
} = require('../cortex/orchestration/artifact_quality_service');

function run() {
  const service = createArtifactQualityService({ fs, path, minArtifactQualityScore: 70 });

  const expectations = inferArtifactExpectations({
    userMessage: 'Criar site institucional em LAMP para veterinário com placeholder',
    executionIntent: 'init_project',
  });
  assert.strictEqual(expectations.enabled, true);
  assert.strictEqual(expectations.lamp, true);
  assert.strictEqual(expectations.domain, 'veterinary');
  assert.strictEqual(
    isNarrowContentEditRequest('Mude o título da página já desenvolvida para "ESSE É UM TESTE"'),
    true
  );
  assert.strictEqual(isNarrowContentEditRequest('Mude o título, layout e cores da página'), false);

  const microEditExpectations = inferArtifactExpectations({
    userMessage: 'Mude o título da página já desenvolvida para "ESSE É UM TESTE"',
    contextText: 'Projeto Next.js institucional com Tailwind',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(microEditExpectations.enabled, false);
  assert.strictEqual(microEditExpectations.narrowContentEdit, true);

  const weak = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'Criar site institucional em LAMP para veterinário com placeholder',
    executionIntent: 'init_project',
    operations: [
      {
        op: 'write_file',
        path: 'index.html',
        content:
          '<h1>Título principal</h1><p>Subtítulo</p><section>Serviço 1</section><section>Contato</section>',
      },
      { op: 'write_file', path: 'style.css', content: 'body { font-family: Arial; }' },
      { op: 'write_file', path: 'script.js', content: '' },
    ],
  });
  assert.strictEqual(weak.enabled, true);
  assert.strictEqual(weak.passesMinimum, false);
  assert.strictEqual(weak.checks.stackEntry, false);
  assert.strictEqual(weak.checks.cssSubstantial, false);
  assert.strictEqual(weak.checks.noGenericPlaceholders, false);
  assert.ok(weak.score < 70);
  assert.ok(weak.criticalFailures.includes('stack_entry'));
  assert.ok(weak.criticalFailures.includes('css_substantial'));

  const strongCss = `
:root { --bg: #f7f6f1; --ink: #17201f; --accent: #2f8f83; --muted: #63706d; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.5; }
.site-header { display: flex; justify-content: space-between; align-items: center; padding: 20px clamp(20px, 5vw, 72px); background: white; border-bottom: 1px solid rgba(0,0,0,.1); }
.hero { min-height: 72vh; display: grid; align-content: center; gap: 20px; padding: clamp(56px, 8vw, 96px) clamp(20px, 5vw, 72px); }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; max-width: 1120px; margin: auto; }
.card { background: white; border: 1px solid rgba(0,0,0,.1); border-radius: 8px; padding: 22px; box-shadow: 0 12px 30px rgba(0,0,0,.08); }
.button { display: inline-flex; padding: 13px 18px; border-radius: 8px; background: var(--accent); color: white; text-decoration: none; font-weight: 800; }
form { display: grid; gap: 12px; max-width: 520px; }
input, textarea { width: 100%; padding: 12px; border: 1px solid rgba(0,0,0,.18); border-radius: 8px; }
@media (max-width: 760px) { .site-header { display: block; } .grid { grid-template-columns: 1fr; } }
`;
  const strong = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'Criar site institucional em LAMP para veterinário com placeholder',
    executionIntent: 'init_project',
    operations: [
      {
        op: 'write_file',
        path: 'index.php',
        content:
          '<?php $sent = false; ?><main><section class="hero"><h1>Clínica veterinária placeholder para pets e famílias</h1><a class="button">Agendar consulta</a></section><section><h2>Serviços veterinários</h2></section><section><h2>Sobre a clínica</h2><p>Cuidado animal, vacinas e consultas.</p></section><section><h2>Contato</h2><form></form></section></main>',
      },
      { op: 'write_file', path: 'style.css', content: strongCss },
      { op: 'write_file', path: 'script.js', content: 'console.log("faber");' },
    ],
  });
  assert.strictEqual(strong.passesMinimum, true);
  assert.strictEqual(strong.checks.stackEntry, true);
  assert.strictEqual(strong.checks.cssSubstantial, true);
  assert.strictEqual(strong.checks.responsive, true);
  assert.ok(strong.score >= 70);

  const nextTailwind = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'Criar página institucional em Next.js com React e Tailwind',
    executionIntent: 'init_project',
    operations: [
      {
        op: 'write_file',
        path: 'package.json',
        content: '{"dependencies":{"next":"^16.0.0","react":"^19.0.0","react-dom":"^19.0.0"},"devDependencies":{"tailwindcss":"^4.0.0","@tailwindcss/postcss":"^4.0.0"}}',
      },
      {
        op: 'write_file',
        path: 'app/layout.tsx',
        content: "import './globals.css'; export default function RootLayout({children}:{children:React.ReactNode}) { return <html><body>{children}</body></html>; }",
      },
      {
        op: 'write_file',
        path: 'app/page.tsx',
        content:
          '<main className="grid min-h-screen gap-8 bg-[var(--color-bg)] px-5 py-20 md:grid-cols-2"><section className="hero max-w-4xl"><h1>Presença digital para agendar conversas</h1><p>Serviços, sobre, depoimentos e contato para uma página institucional.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white" href="#contato">Agendar conversa</a></section><section id="servicos" className="grid gap-4 md:grid-cols-3"><article className="rounded border p-6 shadow">Serviços</article></section><section id="sobre">Sobre</section><section id="contato">Contato</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          '@import "tailwindcss"; :root { --color-bg: #f7f6f1; --color-ink: #1f2424; --color-muted: #66706d; --color-accent: #2f8f83; --color-line: rgba(31,36,36,.14); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); }',
      },
    ],
  });
  assert.strictEqual(nextTailwind.passesMinimum, true);
  assert.strictEqual(nextTailwind.checks.stackEntry, true);
  assert.strictEqual(nextTailwind.checks.tailwindStack, true);
  assert.strictEqual(nextTailwind.checks.cssSubstantial, true);
  assert.strictEqual(nextTailwind.checks.responsive, true);

  const legalDentalDrift = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'Criar site institucional em Next.js com Tailwind e React para advogado empresarial',
    executionIntent: 'init_project',
    operations: [
      {
        op: 'write_file',
        path: 'package.json',
        content: '{"dependencies":{"next":"^16.0.0","react":"^19.0.0","react-dom":"^19.0.0"},"devDependencies":{"tailwindcss":"^4.0.0","@tailwindcss/postcss":"^4.0.0"}}',
      },
      {
        op: 'write_file',
        path: 'app/layout.tsx',
        content: "import './globals.css'; export default function RootLayout({children}:{children:React.ReactNode}) { return <html><body>{children}</body></html>; }",
      },
      {
        op: 'write_file',
        path: 'app/page.tsx',
        content:
          '<main className="grid min-h-screen gap-8 bg-[var(--color-bg)] px-5 py-20 md:grid-cols-2"><section className="hero max-w-4xl"><h1>Clínica Sorriso para consultas odontológicas</h1><p>Dentista, clareamento e implante.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white" href="#contato">Agendar consulta</a></section><section id="servicos">Serviços</section><section id="sobre">Sobre</section><section id="contato">Contato</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          '@import "tailwindcss"; :root { --color-bg: #f7f6f1; --color-ink: #1f2424; --color-muted: #66706d; --color-accent: #2f8f83; --color-line: rgba(31,36,36,.14); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); }',
      },
    ],
  });
  assert.strictEqual(legalDentalDrift.passesMinimum, false);
  assert.strictEqual(legalDentalDrift.checks.contentSpecific, false);
  assert.ok(legalDentalDrift.criticalFailures.includes('content_specific'));

  const contextualLampWeak = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'faz com placeholders',
    contextText: 'Pedido anterior: criar site institucional em LAMP para advogado com placeholders',
    executionIntent: 'init_project',
    operations: [
      { op: 'write_file', path: 'index.html', content: '<main><h1>Advocacia placeholder</h1><section>Serviços</section><section>Sobre</section><section>Contato</section></main>' },
      { op: 'write_file', path: 'style.css', content: strongCss },
      { op: 'write_file', path: 'script.js', content: '' },
    ],
  });
  assert.strictEqual(contextualLampWeak.checks.stackEntry, false);
  assert.ok(contextualLampWeak.criticalFailures.includes('stack_entry'));

  const guidance = service.buildArtifactQualityPromptGuidance({
    userMessage: 'Para uma página inicial apenas',
    executionIntent: 'init_project',
    contextText: 'site institucional em LAMP para veterinário com placeholders',
  });
  assert.ok(guidance.includes('index.php'));
  assert.ok(guidance.includes('veterinário'));

  console.log('artifact-quality-service.test.js: ok');
}

run();
