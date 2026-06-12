const assert = require('assert');
const fs = require('fs');
const os = require('os');
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
  assert.strictEqual(
    isNarrowContentEditRequest(
      'Corrija somente a tipografia e os títulos do THE FORGE. Troque Assistant por IBM Plex Sans via next/font/google. Não altere domínio, serviços, testes ou arquitetura.'
    ),
    true
  );

  const microEditExpectations = inferArtifactExpectations({
    userMessage: 'Mude o título da página já desenvolvida para "ESSE É UM TESTE"',
    contextText: 'Projeto Next.js institucional com Tailwind',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(microEditExpectations.enabled, false);
  assert.strictEqual(microEditExpectations.narrowContentEdit, true);

  const forgeTypographyPatchExpectations = inferArtifactExpectations({
    userMessage:
      'Corrija somente a tipografia e os títulos do THE FORGE. Troque Assistant por IBM Plex Sans via next/font/google. Não altere domínio, serviços, testes ou arquitetura.',
    contextText:
      'Forge MRP com BOM multinível, Prisma/Postgres, Zod, Vitest, Playwright, React Hook Form, TanStack Table e audit log imutável.',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(forgeTypographyPatchExpectations.enabled, false);
  assert.strictEqual(forgeTypographyPatchExpectations.narrowContentEdit, true);

  const forgeBroadVisualExpectations = inferArtifactExpectations({
    userMessage:
      'Melhore o visual completo da plataforma Forge MRP com layout operacional refinado, dashboard, tabelas densas e tema escuro.',
    contextText:
      'Forge MRP com BOM multinível, Prisma/Postgres, Zod, Vitest, Playwright, React Hook Form, TanStack Table e audit log imutável.',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(forgeBroadVisualExpectations.enabled, true);
  assert.strictEqual(forgeBroadVisualExpectations.narrowContentEdit, false);

  const diagnosticMultipageContext = inferArtifactExpectations({
    userMessage:
      'Repare o erro Property snapshot does not exist no THE FORGE. O briefing antigo menciona site institucional multipágina, mas agora é reparo de build.',
    contextText: 'Projeto Next/App Router existente com app/page.tsx e erro de runtime.',
    executionIntent: 'diagnostic_repair',
  });
  assert.strictEqual(diagnosticMultipageContext.diagnosticRepairMode, true);
  assert.strictEqual(diagnosticMultipageContext.staticMultipage, false);

  const tremnStaticPages = inferArtifactExpectations({
    userMessage: [
      'Páginas reais obrigatórias: index.html, a-escola.html, premissas.html, jornada.html, conteudos.html, contato.html.',
      'Conteúdos sobre consciência, liderança e futuro.',
    ].join(' '),
    executionIntent: 'init_project',
  });
  assert.deepStrictEqual(tremnStaticPages.requiredPageIds, [
    'index',
    'a-escola',
    'premissas',
    'jornada',
    'conteudos',
    'contato',
  ]);

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

  const existingStaticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-artifact-edit-'));
  try {
    const existingIndex = [
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>',
      '<main><section class="hero"><h1>Tremn</h1><p>Gestão consciente.</p><a>Quero conhecer</a></section>',
      '<section id="servicos">Jornada e premissas</section><section id="sobre">A Escola</section><section id="contato">Contato</section></main>',
      '<script src="script.js"></script></body></html>',
    ].join('');
    for (const fileName of ['index.html', 'a-escola.html', 'premissas.html', 'jornada.html', 'conteudos.html', 'contato.html']) {
      fs.writeFileSync(path.join(existingStaticRoot, fileName), existingIndex);
    }
    fs.writeFileSync(path.join(existingStaticRoot, 'style.css'), strongCss);
    fs.writeFileSync(path.join(existingStaticRoot, 'script.js'), 'document.body.dataset.ready = "true";');

    const incrementalVisualEdit = service.evaluateOperationBatchArtifactQuality({
      projectRootPath: existingStaticRoot,
      userMessage: 'Ajuste o hero do topo com vídeo de abelhas e duas camadas brancas de blend.',
      contextText: 'Projeto estático multipágina com páginas obrigatórias index.html, a-escola.html, premissas.html, jornada.html, conteudos.html e contato.html.',
      executionIntent: 'edit_project',
      operations: [
        { op: 'write_file', path: 'index.html', content: existingIndex.replace('<main>', '<main><div class="hero-media-stack"></div>') },
        { op: 'append_file', path: 'style.css', content: strongCss + '\n.hero-media-stack { position: absolute; inset: 0; }' },
      ],
    });
    assert.strictEqual(incrementalVisualEdit.enabled, true);
    assert.strictEqual(incrementalVisualEdit.checks.staticMultipageFiles, true);
    assert.strictEqual(incrementalVisualEdit.passesMinimum, true);
  } finally {
    fs.rmSync(existingStaticRoot, { recursive: true, force: true });
  }

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

  const staticForgeShell = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Forge MRP em Next.js com React e Tailwind.',
      'Criar um sistema de manufatura com itens, BOMs, estoque auditável, ordens de produção, cálculo determinístico de necessidades, máquina de estados finitos, audit log e testes unitários.',
      'A interface deve ser operacional orientada a dados, não landing page ou dashboard estático.',
    ].join(' '),
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-6 py-20"><section className="hero grid gap-8 md:grid-cols-2"><h1>Forge MRP</h1><p>Sistema de manufatura com BOMs, estoque, ordens de produção e audit log.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white" href="/ordens">Criar nova ordem</a></section><section className="grid gap-4 md:grid-cols-4"><article className="rounded border p-6 shadow">Itens cadastrados</article><article className="rounded border p-6 shadow">BOMs ativos</article><article className="rounded border p-6 shadow">Ordens abertas</article><article className="rounded border p-6 shadow">Auditoria</article></section><nav><a href="/estoque">Estoque</a><a href="/necessidades">Necessidades</a><a href="/audit-log">Audit log</a></nav></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          '@import "tailwindcss"; :root { --color-bg: #101315; --color-ink: #f2f0e8; --color-muted: #9ca3af; --color-accent: #3fbf87; --color-line: rgba(255,255,255,.16); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); } a { color: inherit; }',
      },
    ],
  });
  assert.strictEqual(staticForgeShell.expectations.complexApp.enabled, true);
  assert.strictEqual(staticForgeShell.passesMinimum, false);
  assert.strictEqual(staticForgeShell.checks.complexAppDomainLayer, false);
  assert.strictEqual(staticForgeShell.checks.complexAppOperableUi, false);
  assert.strictEqual(staticForgeShell.checks.complexAppTests, false);
  assert.strictEqual(staticForgeShell.checks.nextInternalRoutes, false);
  assert.ok(staticForgeShell.criticalFailures.includes('complex_app_domain_layer'));
  assert.ok(staticForgeShell.criticalFailures.includes('complex_app_operable_ui'));
  assert.ok(staticForgeShell.criticalFailures.includes('complex_app_tests'));
  assert.ok(staticForgeShell.criticalFailures.includes('next_internal_routes'));
  assert.ok(staticForgeShell.criticalFailures.includes('forge_mrp_stack'));
  assert.ok(staticForgeShell.criticalFailures.includes('forge_mrp_architecture'));
  assert.ok(staticForgeShell.criticalFailures.includes('forge_mrp_bom_explosion'));
  assert.ok(staticForgeShell.criticalFailures.includes('forge_mrp_visual_system'));

  const shallowForgeMrp = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Forge MRP em Next.js com React, Tailwind, Prisma/Postgres, Zod, Vitest, Playwright, React Hook Form, TanStack Table, Zustand e date-fns.',
      'Criar sistema operacional com cadastro de itens, BOM multinível, estoque auditável, ordens com máquina de estados, cálculo determinístico de necessidades, sugestões de compra, audit log imutável e testes críticos.',
      'O visual deve ser escuro, usar fonte Google Assistant e ter layout operacional refinado.',
    ].join(' '),
    executionIntent: 'init_project',
    operations: [
      {
        op: 'write_file',
        path: 'package.json',
        content: '{"scripts":{"test":"jest"},"dependencies":{"next":"14.2.3","react":"18.3.1","react-dom":"18.3.1","zustand":"4.5.2"},"devDependencies":{"jest":"29.7.0","tailwindcss":"3.4.3","ts-jest":"29.1.2"}}',
      },
      {
        op: 'write_file',
        path: 'app/layout.tsx',
        content: "import './globals.css'; export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang=\"pt-BR\"><body className=\"bg-slate-100 text-slate-900\">{children}</body></html>; }",
      },
      {
        op: 'write_file',
        path: 'app/page.tsx',
        content: [
          "'use client';",
          "import { useState } from 'react';",
          "import { ForgeMRP } from '../lib/mrp';",
          'const engine = new ForgeMRP();',
          'export default function Page(){',
          'const [snapshot,setSnapshot]=useState(engine.getSnapshot());',
          'return <div className="space-y-8"><header><h1>Forge MRP</h1><p>Planejamento de materiais com produção, estoque e auditoria.</p></header><section className="bg-white rounded-xl shadow-sm p-6"><h2>Cadastro de Itens</h2><form><input placeholder="SKU"/><input placeholder="Nome"/><button>Cadastrar</button></form><table><tbody>{snapshot.items.map((item)=><tr key={item.id}><td>{item.sku}</td><td>{item.name}</td></tr>)}</tbody></table></section><section><h2>BOM</h2><p>Sem componentes editáveis.</p></section><section><button>Executar MRP</button></section></div>;',
          '}',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'lib/mrp.ts',
        content: [
          'export class ForgeMRP {',
          'constructor(){ this.snapshot = { items: [], orders: [], stock: [], auditLog: [] }; }',
          'getSnapshot(){ return JSON.parse(JSON.stringify(this.snapshot)); }',
          'runMrp(){ return this.snapshot.items.map((item) => { const orders = this.snapshot.orders.filter((order) => order.itemId === item.id); const grossRequirement = orders.reduce((sum, order) => sum + order.quantity, 0); return { itemId: item.id, grossRequirement, netRequirement: Math.max(0, grossRequirement) }; }); }',
          'moveStock(entry){ if(entry.quantity < 0) throw new Error("Saldo insuficiente"); return entry; }',
          '}',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: '__tests__/mrp.test.ts',
        content: [
          "import { ForgeMRP } from '../lib/mrp';",
          "test('executa MRP determinístico', () => { expect(new ForgeMRP().runMrp()).toBeTruthy(); });",
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          "@tailwind base; @tailwind components; @tailwind utilities; :root { color-scheme: light; } body { font-family: 'Inter', sans-serif; background-color: #f1f5f9; } .input { border: 1px solid #cbd5e1; } .btn { background: #1f2937; }",
      },
    ],
  });
  assert.strictEqual(shallowForgeMrp.passesMinimum, false);
  assert.strictEqual(shallowForgeMrp.checks.forgeMrpStack, false);
  assert.strictEqual(shallowForgeMrp.checks.forgeMrpArchitecture, false);
  assert.strictEqual(shallowForgeMrp.checks.forgeMrpBomExplosion, false);
  assert.strictEqual(shallowForgeMrp.checks.forgeMrpBomCrudUi, false);
  assert.strictEqual(shallowForgeMrp.checks.forgeMrpAuditTrail, false);
  assert.strictEqual(shallowForgeMrp.checks.forgeMrpCriticalTests, false);
  assert.strictEqual(shallowForgeMrp.checks.forgeMrpVisualSystem, false);
  assert.ok(shallowForgeMrp.criticalFailures.includes('forge_mrp_bom_explosion'));
  assert.ok(shallowForgeMrp.criticalFailures.includes('forge_mrp_visual_system'));

  const forgeVerticalSlice = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Forge MRP em Next.js com React, Tailwind, Prisma/Postgres, Zod, Vitest, Playwright, React Hook Form, TanStack Table, Zustand e date-fns.',
      'Criar um sistema de manufatura com itens, BOMs multinível, estoque auditável, ordens de produção, cálculo determinístico de necessidades, máquina de estados finitos, audit log e testes unitários.',
      'A interface deve ser operacional orientada a dados, não landing page ou dashboard estático, com tema escuro e fonte Google Assistant.',
    ].join(' '),
    executionIntent: 'init_project',
    operations: [
      {
        op: 'write_file',
        path: 'package.json',
        content: '{"scripts":{"test":"vitest run","test:e2e":"playwright test"},"dependencies":{"@prisma/client":"^5.0.0","@tanstack/react-table":"^8.0.0","date-fns":"^3.0.0","next":"^16.0.0","react":"^19.0.0","react-dom":"^19.0.0","react-hook-form":"^7.0.0","zod":"^3.0.0","zustand":"^5.0.0"},"devDependencies":{"@playwright/test":"^1.0.0","@tailwindcss/postcss":"^4.0.0","prisma":"^5.0.0","tailwindcss":"^4.0.0","vitest":"^3.0.0"}}',
      },
      {
        op: 'write_file',
        path: 'prisma/schema.prisma',
        content: 'datasource db { provider = "postgresql" url = env("DATABASE_URL") } generator client { provider = "prisma-client-js" } model Item { id String @id sku String @unique name String } model AuditEntry { id String @id entity String action String actor String origin String before Json? after Json? payload Json createdAt DateTime @default(now()) }',
      },
      {
        op: 'write_file',
        path: 'app/layout.tsx',
        content: "import './globals.css'; import { Assistant } from 'next/font/google'; const assistant = Assistant({ subsets: ['latin'], variable: '--font-assistant' }); export default function RootLayout({children}:{children:React.ReactNode}) { return <html><body className={`${assistant.variable} bg-slate-950 text-slate-100`}>{children}</body></html>; }",
      },
      {
        op: 'write_file',
        path: 'app/page.tsx',
        content: [
          "'use client';",
          "import { useMemo, useState } from 'react';",
          "import { useForm } from 'react-hook-form';",
          "import { useReactTable } from '@tanstack/react-table';",
          "import { buildProductionPlan, transitionOrder } from '../src/services/mrp_service';",
          'export default function Page() {',
          "const bomForm = useForm({ defaultValues: { parentItemId: 'chair', componentItemId: 'leg', quantityPer: 4, revision: 'A' } });",
          "const [qty, setQty] = useState(12);",
          "const [status, setStatus] = useState('DRAFT');",
          "const plan = useMemo(() => buildProductionPlan({ orderId: 'OP-100', itemId: 'CHAIR', quantity: qty, actor: 'planner@forge', origin: 'ui' }), [qty]);",
          "const table = useReactTable({ data: plan.requirements, columns: [] as any, getCoreRowModel: undefined as any });",
          "return <main className=\"min-h-screen bg-slate-950 text-slate-100\"><div className=\"mx-auto grid max-w-7xl grid-cols-[260px_1fr] gap-6 px-6 py-8\"><aside className=\"sticky top-6 rounded border border-slate-800 bg-slate-900 p-4\"><h1>Forge MRP Control Room</h1><nav>Itens BOM Estoque Ordens MRP Auditoria</nav></aside><section className=\"grid gap-6\"><div className=\"grid gap-4 lg:grid-cols-4\"><article className=\"rounded border border-slate-800 p-4\"><strong>KPI ordens abertas</strong></article><article className=\"rounded border border-slate-800 p-4\"><strong>Necessidades críticas</strong></article><article className=\"rounded border border-slate-800 p-4\"><strong>Sugestões de compra</strong></article><article className=\"rounded border border-slate-800 p-4\"><strong>Auditoria</strong></article></div><form className=\"grid gap-3 rounded border border-slate-800 p-4\"><input {...bomForm.register('componentItemId')} /><input {...bomForm.register('quantityPer')} /><input {...bomForm.register('revision')} /><button type=\"button\">Adicionar componente BOM</button><button type=\"button\">Editar revisão</button><button type=\"button\">Remover componente</button></form><form className=\"grid gap-3 rounded border border-slate-800 p-4\"><label>Quantidade<input value={qty} onChange={(event) => setQty(Number(event.target.value))} /></label><button type=\"button\" onClick={() => setStatus(transitionOrder(status, 'VALIDATE'))}>Validar ordem</button><button type=\"button\" onClick={() => setStatus(transitionOrder('VALIDATED', 'START'))}>Iniciar produção</button></form><table className=\"w-full rounded border border-slate-800\"><tbody>{plan.requirements.map((row) => <tr key={row.componentItemId}><td>{row.componentItemId}</td><td>{row.grossRequirement}</td><td>{row.shortage}</td><td>{plan.auditLog[0].action}</td></tr>)}</tbody></table><p>{table.getState ? 'TanStack Table pronto' : status}</p></section></div></main>;",
          '}',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'src/domain/mrp.ts',
        content: [
          "export type ProductionStatus = 'DRAFT' | 'VALIDATED' | 'IN_PRODUCTION' | 'DONE' | 'CANCELLED';",
          'export type ItemMaster = { id: string; leadTimeDays: number; lotSize: number; safetyStock: number };',
          'export type BomComponent = { parentItemId: string; componentItemId: string; quantityPer: number; revision: string };',
          'export type StockBalance = Record<string, number>;',
          'export type Requirement = { componentItemId: string; grossRequirement: number; netRequirement: number; shortage: number };',
          'export type AuditEntry = Readonly<{ id: string; entity: string; action: string; actor: string; origin: string; before: unknown; after: unknown; payload: unknown; timestamp: string }>; ',
          'export function appendAudit(log: AuditEntry[], entry: AuditEntry): ReadonlyArray<AuditEntry> { return Object.freeze([...log, Object.freeze(entry)]); }',
          'export function assertNoBomCycle(itemId: string, bom: BomComponent[], visited: string[] = []): void {',
          '  if (visited.includes(itemId)) throw new Error("Ciclo detectado na BOM");',
          '  bom.filter((component) => component.parentItemId === itemId).forEach((component) => assertNoBomCycle(component.componentItemId, bom, [...visited, itemId]));',
          '}',
          'export function explodeBom(rootItemId: string, quantity: number, bom: BomComponent[], stock: StockBalance): Requirement[] {',
          '  const requirements = new Map<string, number>();',
          '  const queue = [{ itemId: rootItemId, quantity }];',
          '  while (queue.length) {',
          '    const current = queue.shift()!;',
          '    for (const component of bom.filter((entry) => entry.parentItemId === current.itemId)) {',
          '      const required = current.quantity * component.quantityPer;',
          '      requirements.set(component.componentItemId, (requirements.get(component.componentItemId) || 0) + required);',
          '      queue.push({ itemId: component.componentItemId, quantity: required });',
          '    }',
          '  }',
          '  return Array.from(requirements.entries()).map(([componentItemId, grossRequirement]) => { const onHand = stock[componentItemId] || 0; const shortage = Math.max(0, grossRequirement - onHand); return { componentItemId, grossRequirement, netRequirement: shortage, shortage }; });',
          '}',
          'export function transitionOrder(current: ProductionStatus, event: string): ProductionStatus {',
          "  const transitions: Record<ProductionStatus, Record<string, ProductionStatus>> = { DRAFT: { VALIDATE: 'VALIDATED', CANCEL: 'CANCELLED' }, VALIDATED: { START: 'IN_PRODUCTION', CANCEL: 'CANCELLED' }, IN_PRODUCTION: { FINISH: 'DONE' }, DONE: {}, CANCELLED: {} };",
          '  const next = transitions[current][event];',
          '  if (!next) throw new Error("Transição inválida da máquina de estados");',
          '  return next;',
          '}',
          'export function reserveAndConsumeStock(stock: StockBalance, componentItemId: string, quantity: number): StockBalance {',
          '  const nextBalance = (stock[componentItemId] || 0) - quantity;',
          '  if (nextBalance < 0) throw new Error("Estoque nunca pode ficar negativo");',
          '  return { ...stock, [componentItemId]: nextBalance };',
          '}',
          'export function consume(stock: StockBalance, componentItemId: string, quantity: number): StockBalance { return reserveAndConsumeStock(stock, componentItemId, quantity); }',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'src/schemas/mrp_schema.ts',
        content: "import { z } from 'zod'; export const itemSchema = z.object({ sku: z.string().min(1), name: z.string().min(1) }); export const bomComponentSchema = z.object({ parentItemId: z.string(), componentItemId: z.string(), quantityPer: z.number().positive(), revision: z.string() });",
      },
      {
        op: 'write_file',
        path: 'src/services/mrp_service.ts',
        content: [
          "import { appendAudit, explodeBom, transitionOrder as transitionOrderDomain, type AuditEntry, type BomComponent } from '../domain/mrp';",
          "export function buildProductionPlan(input: { orderId: string; itemId: string; quantity: number; actor: string; origin: string }) {",
          "  const bom: BomComponent[] = [{ parentItemId: 'CHAIR', componentItemId: 'LEG', quantityPer: 4, revision: 'A' }, { parentItemId: 'CHAIR', componentItemId: 'SEAT', quantityPer: 1, revision: 'A' }, { parentItemId: 'LEG', componentItemId: 'SCREW', quantityPer: 2, revision: 'A' }];",
          "  const before = { status: 'DRAFT', stock: { LEG: 10, SEAT: 2, SCREW: 20 } };",
          "  const requirements = explodeBom(input.itemId, input.quantity, bom, before.stock);",
          "  const after = { status: 'VALIDATED', requirements };",
          "  const audit: AuditEntry = { id: `${input.orderId}-audit`, entity: 'ProductionOrder', action: 'MRP_RUN', actor: input.actor, origin: input.origin, before, after, payload: { orderId: input.orderId }, timestamp: new Date().toISOString() };",
          "  return { requirements, auditLog: appendAudit([], audit) };",
          "}",
          "export function transitionOrder(current: string, event: string) { return transitionOrderDomain(current as any, event); }",
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'tests/mrp.test.ts',
        content: [
          "import { describe, expect, test } from 'vitest';",
          "import { appendAudit, assertNoBomCycle, explodeBom, reserveAndConsumeStock, transitionOrder } from '../src/domain/mrp';",
          "import { bomComponentSchema } from '../src/schemas/mrp_schema';",
          "describe('Forge MRP rules', () => {",
          "  test('explode BOM multinível e calcula faltante exato', () => { const result = explodeBom('CHAIR', 2, [{ parentItemId: 'CHAIR', componentItemId: 'LEG', quantityPer: 4, revision: 'A' }, { parentItemId: 'LEG', componentItemId: 'SCREW', quantityPer: 2, revision: 'A' }], { LEG: 3, SCREW: 4 }); expect(result.find((row) => row.componentItemId === 'LEG')?.shortage).toBe(5); expect(result.find((row) => row.componentItemId === 'SCREW')?.grossRequirement).toBe(16); });",
          "  test('bloqueia saldo negativo de estoque', () => { expect(() => reserveAndConsumeStock({ LEG: 1 }, 'LEG', 2)).toThrow(); });",
          "  test('bloqueia transição inválida da máquina de estados', () => { expect(() => transitionOrder('DONE', 'VALIDATE')).toThrow(); });",
          "  test('detecta ciclo de BOM circular', () => { expect(() => assertNoBomCycle('A', [{ parentItemId: 'A', componentItemId: 'B', quantityPer: 1, revision: 'A' }, { parentItemId: 'B', componentItemId: 'A', quantityPer: 1, revision: 'A' }])).toThrow(); });",
          "  test('mantém audit log imutável com before after actor origin', () => { const audit = appendAudit([], { id: '1', entity: 'Order', action: 'MRP_RUN', actor: 'planner', origin: 'ui', before: {}, after: {}, payload: {}, timestamp: '2026-06-01' }); expect(Object.isFrozen(audit)).toBe(true); });",
          "  test('valida schema Zod de componente BOM', () => { expect(() => bomComponentSchema.parse({ parentItemId: 'A', componentItemId: 'B', quantityPer: 0, revision: 'A' })).toThrow(); });",
          '});',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          "@import \"tailwindcss\"; @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&display=swap'); :root { color-scheme: dark; --color-bg: #020617; --color-ink: #f8fafc; --color-muted: #94a3b8; --color-accent: #22c55e; --color-line: rgba(148,163,184,.28); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); font-family: 'Assistant', system-ui, sans-serif; } input, button, table { font: inherit; } @media (max-width: 760px) { main { padding-inline: 18px; } table { font-size: 14px; } }",
      },
    ],
  });
  assert.strictEqual(forgeVerticalSlice.expectations.complexApp.enabled, true);
  assert.strictEqual(forgeVerticalSlice.checks.complexAppDomainLayer, true);
  assert.strictEqual(forgeVerticalSlice.checks.complexAppOperableUi, true);
  assert.strictEqual(forgeVerticalSlice.checks.complexAppTests, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpStack, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpArchitecture, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpBomExplosion, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpBomCrudUi, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpAuditTrail, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpProductionRules, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpCriticalTests, true);
  assert.strictEqual(forgeVerticalSlice.checks.forgeMrpVisualSystem, true);
  assert.strictEqual(forgeVerticalSlice.checks.nextInternalRoutes, true);
  assert.strictEqual(forgeVerticalSlice.passesMinimum, true);

  const forgeWithModuleDocumentAccess = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Forge MRP em Next.js com React e Tailwind.',
      'Criar um sistema de manufatura com itens, BOMs, estoque auditável, ordens de produção, cálculo determinístico de necessidades, máquina de estados finitos, audit log e testes unitários.',
      'A interface deve ser operacional orientada a dados, não landing page ou dashboard estático.',
    ].join(' '),
    executionIntent: 'init_project',
    operations: [
      {
        op: 'write_file',
        path: 'package.json',
        content: '{"scripts":{"test":"vitest run"},"dependencies":{"next":"^16.0.0","react":"^19.0.0","react-dom":"^19.0.0"},"devDependencies":{"tailwindcss":"^4.0.0","@tailwindcss/postcss":"^4.0.0","vitest":"^3.0.0"}}',
      },
      {
        op: 'write_file',
        path: 'app/layout.tsx',
        content: "import './globals.css'; export default function RootLayout({children}:{children:React.ReactNode}) { return <html><body>{children}</body></html>; }",
      },
      {
        op: 'write_file',
        path: 'app/page.tsx',
        content: [
          '"use client";',
          "import { useMemo, useState } from 'react';",
          "import { calculateRequirements, createAuditEntry, transitionOrder } from '../src/domain/mrp';",
          'export default function Page() {',
          "const [qty, setQty] = useState(12);",
          "const [state, setState] = useState('draft');",
          "const requirements = useMemo(() => calculateRequirements(qty), [qty]);",
          "const audit = createAuditEntry('order-001', state);",
          "return <main className=\"min-h-screen bg-[var(--color-bg)] px-6 py-8 text-[var(--color-ink)]\"><form className=\"grid gap-3 rounded border p-4\"><input value={qty} onChange={(event) => setQty(Number(event.target.value))} /><button type=\"button\" onClick={() => setState(transitionOrder(state, 'release'))}>Liberar ordem</button></form><table><tbody>{requirements.map((row) => <tr key={row.item}><td>{row.item}</td><td>{row.required}</td><td>{audit.action}</td></tr>)}</tbody></table></main>;",
          '}',
          'const style = document.createElement("style");',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'src/domain/mrp.ts',
        content: [
          'export type Requirement = { item: string; required: number };',
          'export function calculateRequirements(quantity: number): Requirement[] { if (quantity <= 0) throw new Error("Quantidade inválida"); return [{ item: "steel-panel", required: quantity * 2 }]; }',
          'export function transitionOrder(current: string, event: string) { if (current === "draft" && event === "release") return "released"; throw new Error("Transição inválida"); }',
          'export function createAuditEntry(orderId: string, status: string) { return { orderId, status, action: `audit:${orderId}:${status}` }; }',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'tests/mrp.test.ts',
        content: [
          "import { describe, expect, test } from 'vitest';",
          "import { calculateRequirements, transitionOrder } from '../src/domain/mrp';",
          "describe('Forge MRP rules', () => {",
          "test('calcula necessidades', () => { expect(calculateRequirements(3)[0].required).toBe(6); });",
          "test('bloqueia transição inválida', () => { expect(() => transitionOrder('closed', 'release')).toThrow(); });",
          '});',
        ].join('\n'),
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          '@import "tailwindcss"; :root { --color-bg: #101315; --color-ink: #f2f0e8; --color-muted: #aab0b5; --color-accent: #3fbf87; --color-line: rgba(255,255,255,.16); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); font-family: Inter, system-ui, sans-serif; } input, button, table { font: inherit; } @media (max-width: 760px) { main { padding-inline: 18px; } table { font-size: 14px; } }',
      },
    ],
  });
  assert.strictEqual(forgeWithModuleDocumentAccess.checks.nextBrowserGlobals, false);
  assert.strictEqual(forgeWithModuleDocumentAccess.passesMinimum, false);
  assert.ok(forgeWithModuleDocumentAccess.criticalFailures.includes('next_browser_globals'));

  const leatherModular = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'Criar landing page em Next.js para artefatos de couro, bolsas, pastas, produção artesanal e longevidade',
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-6 py-20"><section className="hero grid gap-10 md:grid-cols-2"><h1>Peças de couro feitas para atravessar anos</h1><p>Bolsas, pastas e acessórios com produção artesanal, couro selecionado e visual europeu.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white" href="#contato">Conhecer coleções</a></section><section id="colecoes" className="grid gap-4 md:grid-cols-3"><article className="rounded border p-6 shadow">Bolsas de couro</article><article className="rounded border p-6 shadow">Pastas em couro</article></section><section id="materia-prima" className="grid gap-6 md:grid-cols-2">Matéria-prima, durabilidade e longevidade do couro natural.</section><section id="processo" className="grid gap-6 md:grid-cols-3">Processo artesanal em etapas pequenas.</section><section id="cuidados">FAQ e cuidados para preservar a peça.</section><section id="contato">Contato para encomendas e catálogo.</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          '@import "tailwindcss"; :root { --color-bg: #fcf7e3; --color-ink: #1f2424; --color-muted: #66706d; --color-accent: #8f3447; --color-line: rgba(31,36,36,.14); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); }',
      },
    ],
  });
  assert.strictEqual(leatherModular.checks.requiredSections, true);
  assert.strictEqual(leatherModular.passesMinimum, true);

  const inferredTailwindFromPackage = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'Criar página institucional em Next.js para escritório de advocacia',
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
          '<main className="grid min-h-screen gap-8 bg-[var(--color-bg)] px-5 py-20 md:grid-cols-2"><section className="hero max-w-4xl"><h1>Advocacia de propriedade intelectual</h1><p>Serviços, sobre, depoimentos, FAQ e contato para marcas, patentes e software.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white" href="#contato">Agendar consulta</a></section><section id="servicos" className="grid gap-4 md:grid-cols-3"><article className="rounded border p-6 shadow">Marcas</article></section><section id="sobre">Sobre</section><section id="contato">Contato</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          '@import "tailwindcss"; :root { --color-bg: #f7f4ec; --color-ink: #1d252c; --color-muted: #66706d; --color-accent: #183b73; --color-line: rgba(31,36,36,.14); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); }',
      },
    ],
  });
  assert.strictEqual(inferredTailwindFromPackage.checks.cssSubstantial, true);
  assert.strictEqual(inferredTailwindFromPackage.passesMinimum, true);

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

  const tremnWrongDomain = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Criar site estático multipágina para Tremn — Escola de Gestão Consciente.',
      'Rotas obrigatórias: Início, A Escola, Premissas, Jornada, Conteúdos e Contato.',
      'Use conteúdo final do briefing atual, sem conteúdo de projetos anteriores.',
    ].join(' '),
    executionIntent: 'init_project',
    workGraph: {
      briefSpec: {
        brandName: 'Tremn — Escola de Gestão Consciente',
        pages: [
          { slug: 'index', title: 'Início' },
          { slug: 'a-escola', title: 'A Escola' },
          { slug: 'premissas', title: 'Premissas' },
          { slug: 'jornada', title: 'Jornada' },
          { slug: 'conteudos', title: 'Conteúdos' },
          { slug: 'contato', title: 'Contato' },
        ],
      },
    },
    operations: [
      {
        op: 'write_file',
        path: 'index.html',
        content:
          '<!doctype html><html><head><title>Clínica Sorriso</title><link rel="stylesheet" href="style.css"></head><body><main><section class="hero"><h1>Clínica Sorriso</h1><p>Atendimento placeholder premium.</p><a href="#contato">Agendar consulta</a></section><section>Serviços</section><section>Sobre</section><section id="contato">Contato</section></main><script src="script.js"></script></body></html>',
      },
      {
        op: 'write_file',
        path: 'style.css',
        content:
          ':root { --bg:#f8f7f2; --ink:#2d2a29; --accent:#f0be43; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Inter,sans-serif; } .hero { min-height:70vh; display:grid; gap:24px; padding:80px 8vw; } section { padding:64px 8vw; } @media (max-width: 760px) { .hero { padding:56px 24px; } }',
      },
      {
        op: 'write_file',
        path: 'script.js',
        content: 'document.body.dataset.ready = "true";',
      },
    ],
  });
  assert.strictEqual(tremnWrongDomain.passesMinimum, false);
  assert.ok(tremnWrongDomain.criticalFailures.includes('expected_brand_missing'));
  assert.ok(tremnWrongDomain.criticalFailures.includes('stale_fallback_brand'));
  assert.ok(tremnWrongDomain.criticalFailures.includes('static_multipage_files'));

  const placeholderFinalImport = service.evaluateOperationBatchArtifactQuality({
    userMessage: 'Briefing Completo: criar landing page final de importação com cotação, WhatsApp e formulário completo.',
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-5 py-20"><section className="hero grid gap-8 md:grid-cols-2"><h1>Faber Projeto</h1><p>Atendimento placeholder premium com conteúdo provisório pronto para evoluir.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white">Agendar conversa</a></section><section id="servicos" className="grid gap-4 md:grid-cols-3"><article className="rounded border p-6 shadow">Serviços</article></section><section id="contato">Contato</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content:
          '@import "tailwindcss"; :root { --color-bg: #f4f7fb; --color-ink: #162033; --color-muted: #66706d; --color-accent: #0b1f3a; --color-line: rgba(31,36,36,.14); } body { margin: 0; background: var(--color-bg); color: var(--color-ink); }',
      },
    ],
  });
  assert.strictEqual(placeholderFinalImport.checks.noGenericPlaceholders, false);
  assert.strictEqual(placeholderFinalImport.passesMinimum, false);
  assert.ok(placeholderFinalImport.criticalFailures.includes('generic_placeholders'));

  const chocolateResidualCopy = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Landing Page Chocolate Premium',
      'Nome do produto',
      'Cacau Nobre Atelier',
      'Criar landing page final para chocolate artesanal premium, catálogo, depoimentos e compra por contato.',
      'Sem placeholder genérico.',
    ].join('\n'),
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-5 py-20"><section className="hero grid gap-8 md:grid-cols-2"><h1>Cacau Nobre Atelier</h1><p>Chocolate artesanal premium.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white">Comprar agora</a></section><section id="produtos">Bombons e tabletes</section><section id="depoimentos">Depoimentos</section><section id="faq"><h2>O conteúdo do site é definitivo?</h2><p>Esta primeira versão usa copy contextual.</p></section><section id="contato">contato@maisoncacao.com</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content: strongCss,
      },
    ],
  });
  assert.strictEqual(chocolateResidualCopy.checks.noGenericPlaceholders, false);
  assert.strictEqual(chocolateResidualCopy.checks.noStaleFallbackBrands, false);
  assert.strictEqual(chocolateResidualCopy.passesMinimum, false);
  assert.ok(chocolateResidualCopy.criticalFailures.includes('generic_placeholders'));
  assert.ok(chocolateResidualCopy.criticalFailures.includes('stale_fallback_brand'));

  const aureaStaleFallback = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing Completo: criar landing page final para Aurea IP & Patentes.',
      'Escritório de Patentes com patentes, marcas, desenhos industriais, busca de anterioridade, INPI e proteção internacional.',
      'Sem placeholder genérico.',
    ].join(' '),
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-5 py-20"><section className="hero grid gap-8 md:grid-cols-2"><h1>Escritório Faber Advocacia</h1><p>Uma presença digital clara para transformar visitantes em contatos.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white">Agendar conversa</a></section><section id="servicos">Serviços</section><section id="contato">Contato</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content: strongCss,
      },
    ],
  });
  assert.strictEqual(aureaStaleFallback.checks.noGenericPlaceholders, false);
  assert.strictEqual(aureaStaleFallback.checks.contentSpecific, false);
  assert.strictEqual(aureaStaleFallback.passesMinimum, false);
  assert.ok(aureaStaleFallback.criticalFailures.includes('generic_placeholders'));

  const lineaStaleMemory = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing Completo: criar site completo final para Linea Bosco Revestimentos.',
      'Produtos: pisos de madeira, painéis ripados, decks, revestimentos naturais, acabamentos arquitetônicos, projetos e orçamento.',
      'Sem placeholder genérico.',
    ].join(' '),
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-5 py-20"><section className="hero grid gap-8 md:grid-cols-2"><h1>Studio Habitat</h1><p>Helena Duarte Arquitetura cria arquitetura contemporânea para espaços com identidade.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white">Solicitar proposta</a></section><section id="projetos">Projetos selecionados</section><section id="contato">Contato</section></main>',
      },
      {
        op: 'write_file',
        path: 'app/globals.css',
        content: strongCss,
      },
    ],
  });
  assert.strictEqual(lineaStaleMemory.checks.noGenericPlaceholders, false);
  assert.strictEqual(lineaStaleMemory.checks.contentSpecific, false);
  assert.strictEqual(lineaStaleMemory.passesMinimum, false);
  assert.ok(lineaStaleMemory.criticalFailures.includes('generic_placeholders'));

  const vitraPureStaleLeather = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Landing Page de Garrafas de Vidro',
      'Nome da marca',
      'VitraPure',
      'Criar landing page final para garrafas de vidro reutilizáveis, livres de BPA, sustentáveis, com produtos Essential, Aura e Terra.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-5 py-20"><section className="hero"><h1>Atelier Couro Faber</h1><p>Bolsas de couro feitas para atravessar anos.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white">Conhecer coleções</a></section><section id="servicos">Bolsas e pastas</section><section id="contato">Contato</section></main>',
      },
      { op: 'write_file', path: 'app/globals.css', content: strongCss },
    ],
  });
  assert.strictEqual(vitraPureStaleLeather.checks.expectedBrandPresent, false);
  assert.strictEqual(vitraPureStaleLeather.checks.noStaleFallbackBrands, false);
  assert.strictEqual(vitraPureStaleLeather.passesMinimum, false);
  assert.ok(vitraPureStaleLeather.criticalFailures.includes('expected_brand_missing'));
  assert.ok(vitraPureStaleLeather.criticalFailures.includes('stale_fallback_brand'));

  const alumivanceStaleArchitecture = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Site de Empresa de Esquadrias de Alumínio e ACM',
      'Nome da empresa',
      'Alumivance Esquadrias & Fachadas',
      'Criar site completo final com soluções, projetos, calculadora de orçamento, blog, contato e trabalhe conosco.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-5 py-20"><section className="hero"><h1>Helena Duarte Arquitetura</h1><p>Arquitetura contemporânea para espaços com identidade.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white">Solicitar proposta</a></section><section id="servicos">Interiores residenciais</section><section id="contato">Contato</section></main>',
      },
      { op: 'write_file', path: 'app/globals.css', content: strongCss },
    ],
  });
  assert.strictEqual(alumivanceStaleArchitecture.checks.expectedBrandPresent, false);
  assert.strictEqual(alumivanceStaleArchitecture.checks.noStaleFallbackBrands, false);
  assert.strictEqual(alumivanceStaleArchitecture.passesMinimum, false);
  assert.ok(alumivanceStaleArchitecture.criticalFailures.includes('expected_brand_missing'));
  assert.ok(alumivanceStaleArchitecture.criticalFailures.includes('stale_fallback_brand'));

  const alumivancePartialStalePerson = service.evaluateOperationBatchArtifactQuality({
    userMessage: [
      'Briefing completo — Site de Empresa de Esquadrias de Alumínio e ACM',
      'Nome da empresa',
      'Alumivance Esquadrias & Fachadas',
      'Criar site completo final com soluções, projetos, calculadora de orçamento, blog, contato e trabalhe conosco.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
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
          '<main className="min-h-screen bg-[var(--color-bg)] px-5 py-20"><section className="hero"><h1>Alumivance Esquadrias & Fachadas</h1><p>Esquadrias de alumínio, fachadas em ACM e pele de vidro para obras corporativas.</p><a className="rounded bg-[var(--color-accent)] px-5 py-3 text-white">Solicitar orçamento</a></section><section id="servicos">Soluções técnicas</section><section id="equipe">Helena Duarte — CEO e Cofundadora</section><section id="contato">Contato</section></main>',
      },
      { op: 'write_file', path: 'app/globals.css', content: strongCss },
    ],
  });
  assert.strictEqual(alumivancePartialStalePerson.checks.expectedBrandPresent, true);
  assert.strictEqual(alumivancePartialStalePerson.checks.noStaleFallbackBrands, false);
  assert.strictEqual(alumivancePartialStalePerson.passesMinimum, false);
  assert.ok(alumivancePartialStalePerson.criticalFailures.includes('stale_fallback_brand'));

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
  assert.strictEqual(guidance.includes('hero, serviços, sobre, contato'), false);

  console.log('artifact-quality-service.test.js: ok');
}

run();
