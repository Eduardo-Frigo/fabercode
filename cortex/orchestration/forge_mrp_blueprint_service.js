function normalizeForgeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function collectForgeSource({ userMessage = '', contextText = '', workGraph = null, workingBrief = null } = {}) {
  const parts = [userMessage, contextText];
  if (workGraph && typeof workGraph === 'object') {
    parts.push(workGraph.brief || '');
    if (Array.isArray(workGraph.acceptanceCriteria)) parts.push(workGraph.acceptanceCriteria.join(' '));
    if (workGraph.briefSpec) {
      try {
        parts.push(JSON.stringify(workGraph.briefSpec));
      } catch {
        parts.push(String(workGraph.briefSpec || ''));
      }
    }
  }
  if (workingBrief && typeof workingBrief === 'object') {
    const product = workingBrief.product && typeof workingBrief.product === 'object' ? workingBrief.product : {};
    const source = workingBrief.source && typeof workingBrief.source === 'object' ? workingBrief.source : {};
    parts.push(workingBrief.executionPrompt || '');
    parts.push(source.current || '', source.consolidated || '');
    parts.push(product.brandFallback || '', product.domainLabel || '', product.domain || '', product.stack || '');
  }
  return parts.filter(Boolean).join('\n');
}

function isForgeMrpRequest(options = {}) {
  const current = normalizeForgeText(options && options.userMessage ? options.userMessage : '');
  const visualOnlyEdit =
    /\b(tipografia|tipografias|typography|fontes?|next\/font|google fonts?|ibm plex|assistant|metadata\.title|h1|tracking|espacamento|espaçamento|visual|tema|tailwind|globals\.css|classes?)\b/.test(current) &&
    !/\b(prisma|postgres|zod|vitest|playwright|react hook form|tanstack|zustand|date-fns|bom|bill of materials|estoque|ordens? de producao|audit log|auditoria|mrp multinivel|mrp multinível|dominio|domínio|servicos|serviços|use-cases|schema)\b/.test(current);
  if (visualOnlyEdit) return false;

  const source = normalizeForgeText(collectForgeSource(options));
  const hasForgeMrpSubject = /\bforge mrp\b/.test(source) ||
    (/\bmrp\b/.test(source) &&
      /\b(manufatura|manufacturing|bom|bill of materials|estoque|ordens? de producao|necessidades|audit log|auditoria)\b/.test(source));
  const hasStructuralIntent = /\b(criar|crie|recriar|recrie|implementar|implemente|corrigir integralmente|cumprir integralmente|fatia vertical|arquitetura|prisma|postgres|zod|vitest|playwright|react hook form|tanstack|bom|estoque|ordens? de producao|audit log|mrp multinivel|mrp multinível|dominio|domínio|servicos|serviços)\b/.test(source);
  return Boolean(hasForgeMrpSubject && hasStructuralIntent);
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function packageJsonContent() {
  return json({
    private: true,
    name: 'forge-mrp',
    scripts: {
      dev: 'next dev',
      build: 'next build',
      test: 'vitest run',
      'test:e2e': 'playwright test',
      postinstall: 'prisma generate',
      prisma: 'prisma validate',
      'db:up': 'docker compose up -d postgres',
      'db:generate': 'prisma generate',
      'db:migrate': 'prisma migrate deploy',
      'db:seed': 'node scripts/seed.mjs',
      'db:check': 'node scripts/db-check.mjs',
    },
    dependencies: {
      '@prisma/client': '^5.22.0',
      '@tanstack/react-table': '^8.21.3',
      'date-fns': '^3.6.0',
      next: '15.5.19',
      react: '19.2.7',
      'react-dom': '19.2.7',
      'react-hook-form': '^7.53.0',
      zod: '^3.24.1',
      zustand: '^5.0.2',
    },
    devDependencies: {
      '@playwright/test': '1.51.1',
      '@tailwindcss/postcss': '^4.0.0',
      '@types/node': '^22.10.0',
      '@types/react': '19.2.16',
      '@types/react-dom': '19.2.3',
      prisma: '^5.22.0',
      tailwindcss: '^4.0.0',
      tsx: '^4.20.6',
      typescript: '^5.7.0',
      vitest: '^3.0.0',
    },
    prisma: {
      seed: 'node scripts/seed.mjs',
    },
  });
}

function envContent() {
  return 'DATABASE_URL="postgresql://forge:forge@localhost:5432/forge_mrp?schema=public"\n';
}

function dockerComposeContent() {
  return `services:
  postgres:
    image: postgres:16-alpine
    container_name: forge-mrp-postgres
    environment:
      POSTGRES_USER: forge
      POSTGRES_PASSWORD: forge
      POSTGRES_DB: forge_mrp
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U forge -d forge_mrp"]
      interval: 5s
      timeout: 5s
      retries: 12
    volumes:
      - forge_mrp_pgdata:/var/lib/postgresql/data

volumes:
  forge_mrp_pgdata:
`;
}

function prismaSchemaContent() {
  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Item {
  id           String   @id
  sku          String   @unique
  name         String
  unit         String
  leadTimeDays Int    @default(0)
  lotSize      Int     @default(1)
  safetyStock  Int     @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model BomRevision {
  id           String         @id
  parentItemId String
  revision     String
  status       String
  components   BomComponent[]
  createdAt    DateTime       @default(now())

  @@unique([parentItemId, revision])
}

model BomComponent {
  id              String      @id @default(cuid())
  bomRevisionId   String
  parentItemId    String
  componentItemId String
  quantityPer     Float
  revision        String
  active          Boolean     @default(true)
  scrapPercent    Float       @default(0)
  bomRevision     BomRevision @relation(fields: [bomRevisionId], references: [id])

  @@index([parentItemId, revision, active])
}

model ProductionOrder {
  id        String   @id
  code      String   @unique
  itemId    String
  quantity  Int
  status    String
  dueDate   DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model StockMovement {
  id        String   @id @default(cuid())
  itemId    String
  quantity  Int
  type      String
  origin    String
  actor     String
  createdAt DateTime @default(now())
}

model AuditEntry {
  id        String   @id @default(cuid())
  entity    String
  entityId  String
  action    String
  actor     String
  origin    String
  before    Json?
  after     Json?
  payload   Json?
  createdAt DateTime @default(now())
}
`;
}

function prismaMigrationContent() {
  return `CREATE TABLE "Item" (
  "id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
  "lotSize" INTEGER NOT NULL DEFAULT 1,
  "safetyStock" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Item_sku_key" ON "Item"("sku");

CREATE TABLE "BomRevision" (
  "id" TEXT NOT NULL,
  "parentItemId" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BomRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BomRevision_parentItemId_revision_key" ON "BomRevision"("parentItemId", "revision");

CREATE TABLE "BomComponent" (
  "id" TEXT NOT NULL,
  "bomRevisionId" TEXT NOT NULL,
  "parentItemId" TEXT NOT NULL,
  "componentItemId" TEXT NOT NULL,
  "quantityPer" DOUBLE PRECISION NOT NULL,
  "revision" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "scrapPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "BomComponent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BomComponent_parentItemId_revision_active_idx" ON "BomComponent"("parentItemId", "revision", "active");

ALTER TABLE "BomComponent"
ADD CONSTRAINT "BomComponent_bomRevisionId_fkey"
FOREIGN KEY ("bomRevisionId") REFERENCES "BomRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductionOrder" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionOrder_code_key" ON "ProductionOrder"("code");

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEntry" (
  "id" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);
`;
}

function seedScriptContent() {
  return `import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const items = [
  { id: 'ASM-900', sku: 'ASM-900', name: 'Forno Industrial Série 900', unit: 'un', leadTimeDays: 14, lotSize: 1, safetyStock: 0 },
  { id: 'FRM-100', sku: 'FRM-100', name: 'Chassi Principal', unit: 'un', leadTimeDays: 5, lotSize: 10, safetyStock: 2 },
  { id: 'MTR-001', sku: 'MTR-001', name: 'Motor Elétrico 5HP', unit: 'un', leadTimeDays: 7, lotSize: 5, safetyStock: 1 },
  { id: 'SCR-050', sku: 'SCR-050', name: 'Parafuso Inox M6', unit: 'un', leadTimeDays: 2, lotSize: 100, safetyStock: 50 },
];

const stock = { 'ASM-900': 1, 'FRM-100': 2, 'MTR-001': 1, 'SCR-050': 80 };

async function main() {
  await prisma.auditEntry.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.productionOrder.deleteMany();
  await prisma.bomComponent.deleteMany();
  await prisma.bomRevision.deleteMany();
  await prisma.item.deleteMany();

  for (const item of items) {
    await prisma.item.create({ data: item });
  }

  const revision = await prisma.bomRevision.create({
    data: { id: 'seed-rev-assembly-a', parentItemId: 'ASM-900', revision: 'A', status: 'ACTIVE' },
  });
  const frameRevision = await prisma.bomRevision.create({
    data: { id: 'seed-rev-frame-a', parentItemId: 'FRM-100', revision: 'A', status: 'ACTIVE' },
  });
  await prisma.bomComponent.createMany({
    data: [
      { bomRevisionId: revision.id, parentItemId: 'ASM-900', componentItemId: 'FRM-100', quantityPer: 1, revision: 'A', active: true },
      { bomRevisionId: revision.id, parentItemId: 'ASM-900', componentItemId: 'MTR-001', quantityPer: 2, revision: 'A', active: true },
      { bomRevisionId: frameRevision.id, parentItemId: 'FRM-100', componentItemId: 'SCR-050', quantityPer: 24, revision: 'A', active: true },
    ],
  });

  await prisma.productionOrder.create({
    data: {
      id: 'OP-2026-014',
      code: 'OP-2026-014',
      itemId: 'ASM-900',
      quantity: 4,
      status: 'DRAFT',
      dueDate: new Date('2026-06-14T12:00:00.000Z'),
    },
  });

  for (const [itemId, quantity] of Object.entries(stock)) {
    await prisma.stockMovement.create({
      data: { itemId, quantity, type: 'OPENING_BALANCE', origin: 'seed', actor: 'system' },
    });
  }

  await prisma.auditEntry.create({
    data: {
      entity: 'System',
      entityId: 'forge-seed',
      action: 'SEED',
      actor: 'system',
      origin: 'prisma/seed',
      payload: { items: items.length, stock },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('Forge MRP seed applied');
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
`;
}

function dbCheckScriptContent() {
  return `import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$connect();
  const [items, orders, bomComponents] = await Promise.all([
    prisma.item.count(),
    prisma.productionOrder.count(),
    prisma.bomComponent.count(),
  ]);
  if (items < 4 || orders < 1 || bomComponents < 3) {
    throw new Error(\`Seed incompleto: items=\${items}, orders=\${orders}, bomComponents=\${bomComponents}\`);
  }
  console.log(\`PRISMA_CONNECT_OK items=\${items} orders=\${orders} bomComponents=\${bomComponents}\`);
} catch (error) {
  console.error('PRISMA_CONNECT_FAILED', error && error.message ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
`;
}

function prismaClientContent() {
  return `import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { forgePrisma?: PrismaClient };

export const prisma = globalForPrisma.forgePrisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.forgePrisma = prisma;
}
`;
}

function repositoryContent() {
  return `import { prisma } from './prisma';
import { buildProductionPlan, createBomRevisionDraft, transitionOrderAction } from '../services/use-cases/mrp_service';
import type { AuditEntry, BomComponent, ItemMaster, ProductionEvent, ProductionStatus, StockBalance } from '../domain/mrp';

function toAudit(entry: {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  origin: string;
  before: unknown;
  after: unknown;
  payload: unknown;
  createdAt: Date;
}): AuditEntry {
  return {
    id: entry.id,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    actor: entry.actor,
    origin: entry.origin,
    before: entry.before,
    after: entry.after,
    payload: entry.payload,
    timestamp: entry.createdAt.toISOString(),
  };
}

async function readStock(): Promise<StockBalance> {
  const rows = await prisma.stockMovement.groupBy({
    by: ['itemId'],
    _sum: { quantity: true },
  });
  return Object.fromEntries(rows.map((row) => [row.itemId, row._sum.quantity || 0]));
}

export async function getForgeSnapshot() {
  const [items, components, order, auditLog, stock] = await Promise.all([
    prisma.item.findMany({ orderBy: { sku: 'asc' } }),
    prisma.bomComponent.findMany({ where: { active: true }, orderBy: [{ parentItemId: 'asc' }, { componentItemId: 'asc' }] }),
    prisma.productionOrder.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.auditEntry.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
    readStock(),
  ]);

  return {
    items: items.map((item): ItemMaster => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      leadTimeDays: item.leadTimeDays,
      lotSize: item.lotSize,
      safetyStock: item.safetyStock,
    })),
    bom: components.map((component): BomComponent => ({
      parentItemId: component.parentItemId,
      componentItemId: component.componentItemId,
      quantityPer: component.quantityPer,
      revision: component.revision,
      active: component.active,
    })),
    stock,
    order: order
      ? {
          id: order.id,
          code: order.code,
          itemId: order.itemId,
          quantity: order.quantity,
          status: order.status as ProductionStatus,
        }
      : null,
    auditLog: auditLog.map(toAudit),
  };
}

export async function saveBomComponent(input: unknown) {
  const draft = createBomRevisionDraft(input);
  const revision = await prisma.bomRevision.upsert({
    where: { parentItemId_revision: { parentItemId: draft.parentItemId, revision: draft.revision } },
    update: { status: 'ACTIVE' },
    create: {
      id: \`rev-\${draft.parentItemId.toLowerCase()}-\${draft.revision.toLowerCase()}\`,
      parentItemId: draft.parentItemId,
      revision: draft.revision,
      status: 'ACTIVE',
    },
  });
  await prisma.bomComponent.deleteMany({
    where: {
      parentItemId: draft.parentItemId,
      componentItemId: draft.componentItemId,
      revision: draft.revision,
    },
  });
  await prisma.bomComponent.create({
    data: {
      bomRevisionId: revision.id,
      parentItemId: draft.parentItemId,
      componentItemId: draft.componentItemId,
      quantityPer: draft.quantityPer,
      revision: draft.revision,
      active: draft.active,
    },
  });
  await prisma.auditEntry.create({
    data: {
      entity: 'BomComponent',
      entityId: \`\${draft.parentItemId}:\${draft.componentItemId}:\${draft.revision}\`,
      action: 'BOM_UPSERT',
      actor: 'planner@forge.local',
      origin: 'api/forge/bom',
      payload: draft,
    },
  });
  return getForgeSnapshot();
}

export async function runPersistedMrp(input: { orderId: string; itemId: string; quantity: number; actor: string; origin: string }) {
  const snapshot = await getForgeSnapshot();
  const plan = buildProductionPlan({
    ...input,
    bom: snapshot.bom,
    stock: snapshot.stock,
    items: snapshot.items,
  });
  await prisma.auditEntry.create({
    data: {
      entity: 'ProductionOrder',
      entityId: input.orderId,
      action: 'MRP_RUN',
      actor: input.actor,
      origin: input.origin,
      before: { stock: snapshot.stock, status: snapshot.order?.status || 'DRAFT' },
      after: { requirements: plan.requirements },
      payload: { itemId: input.itemId, quantity: input.quantity },
    },
  });
  return { snapshot: await getForgeSnapshot(), plan };
}

export async function transitionPersistedOrder(input: { orderId: string; event: ProductionEvent }) {
  const order = await prisma.productionOrder.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error('Ordem não encontrada.');
  const nextStatus = transitionOrderAction(order.status as ProductionStatus, input.event);
  await prisma.productionOrder.update({ where: { id: order.id }, data: { status: nextStatus } });
  await prisma.auditEntry.create({
    data: {
      entity: 'ProductionOrder',
      entityId: order.id,
      action: \`ORDER_\${input.event}\`,
      actor: 'planner@forge.local',
      origin: 'api/forge/order',
      before: { status: order.status },
      after: { status: nextStatus },
    },
  });
  return getForgeSnapshot();
}
`;
}

function snapshotRouteContent() {
  return `import { NextResponse } from 'next/server';
import { getForgeSnapshot } from '../../../../src/server/forge_repository';

export async function GET() {
  try {
    const snapshot = await getForgeSnapshot();
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Falha ao carregar snapshot Forge.' },
      { status: 503 }
    );
  }
}
`;
}

function bomRouteContent() {
  return `import { NextResponse } from 'next/server';
import { saveBomComponent } from '../../../../src/server/forge_repository';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const snapshot = await saveBomComponent(body);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Falha ao salvar BOM.' },
      { status: 400 }
    );
  }
}
`;
}

function mrpRouteContent() {
  return `import { NextResponse } from 'next/server';
import { runPersistedMrp } from '../../../../src/server/forge_repository';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runPersistedMrp({
      orderId: String(body.orderId || 'OP-2026-014'),
      itemId: String(body.itemId || 'ASM-900'),
      quantity: Number(body.quantity || 1),
      actor: String(body.actor || 'planner@forge.local'),
      origin: String(body.origin || 'api/forge/mrp'),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Falha ao executar MRP.' },
      { status: 400 }
    );
  }
}
`;
}

function orderRouteContent() {
  return `import { NextResponse } from 'next/server';
import { transitionPersistedOrder } from '../../../../src/server/forge_repository';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const snapshot = await transitionPersistedOrder({
      orderId: String(body.orderId || 'OP-2026-014'),
      event: body.event,
    });
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Falha ao alterar ordem.' },
      { status: 400 }
    );
  }
}
`;
}

function nextConfigContent() {
  return `const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
`;
}

function layoutContent() {
  return `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Forge MRP',
  description: 'Planejamento de materiais para manufatura discreta com BOM, estoque, ordens e auditoria.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body suppressHydrationWarning className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
`;
}

function domainContent() {
  return `export type ProductionStatus = 'DRAFT' | 'VALIDATED' | 'IN_PRODUCTION' | 'DONE' | 'CANCELLED';
export type ProductionEvent = 'VALIDATE' | 'START' | 'FINISH' | 'CANCEL';

export type ItemMaster = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  leadTimeDays: number;
  lotSize: number;
  safetyStock: number;
};

export type BomComponent = {
  parentItemId: string;
  componentItemId: string;
  quantityPer: number;
  revision: string;
  active: boolean;
};

export type StockBalance = Record<string, number>;

export type Requirement = {
  componentItemId: string;
  grossRequirement: number;
  available: number;
  safetyStock: number;
  netRequirement: number;
  shortage: number;
  lotSize: number;
  plannedOrderQty: number;
  leadTimeDays: number;
  releaseOffsetDays: number;
};

export type AuditEntry = Readonly<{
  id: string;
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  origin: string;
  before: unknown;
  after: unknown;
  payload: unknown;
  timestamp: string;
}>;

export function createSeedData() {
  const items: ItemMaster[] = [
    { id: 'ASM-900', sku: 'ASM-900', name: 'Forno Industrial Série 900', unit: 'un', leadTimeDays: 14, lotSize: 1, safetyStock: 0 },
    { id: 'FRM-100', sku: 'FRM-100', name: 'Chassi Principal', unit: 'un', leadTimeDays: 5, lotSize: 10, safetyStock: 2 },
    { id: 'MTR-001', sku: 'MTR-001', name: 'Motor Elétrico 5HP', unit: 'un', leadTimeDays: 7, lotSize: 5, safetyStock: 1 },
    { id: 'SCR-050', sku: 'SCR-050', name: 'Parafuso Inox M6', unit: 'un', leadTimeDays: 2, lotSize: 100, safetyStock: 50 },
  ];
  const bom: BomComponent[] = [
    { parentItemId: 'ASM-900', componentItemId: 'FRM-100', quantityPer: 1, revision: 'A', active: true },
    { parentItemId: 'ASM-900', componentItemId: 'MTR-001', quantityPer: 2, revision: 'A', active: true },
    { parentItemId: 'FRM-100', componentItemId: 'SCR-050', quantityPer: 24, revision: 'A', active: true },
  ];
  const stock: StockBalance = { 'ASM-900': 1, 'FRM-100': 2, 'MTR-001': 1, 'SCR-050': 80 };
  return { items, bom, stock };
}

function cloneSerializable<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreezeSerializable<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  Object.values(value as Record<string, unknown>).forEach((nested) => {
    deepFreezeSerializable(nested);
  });
  return value;
}

export function appendAudit(log: readonly AuditEntry[], entry: AuditEntry): ReadonlyArray<AuditEntry> {
  const frozenEntry = deepFreezeSerializable({
    ...entry,
    before: cloneSerializable(entry.before),
    after: cloneSerializable(entry.after),
    payload: cloneSerializable(entry.payload),
  });
  return Object.freeze([...log, frozenEntry]);
}

export function assertNoBomCycle(itemId: string, bom: BomComponent[], visited: string[] = []): void {
  if (visited.includes(itemId)) throw new Error('Ciclo detectado na BOM');
  for (const component of bom.filter((entry) => entry.active && entry.parentItemId === itemId)) {
    assertNoBomCycle(component.componentItemId, bom, [...visited, itemId]);
  }
}

function roundToLot(quantity: number, lotSize: number): number {
  if (quantity <= 0) return 0;
  const safeLot = Math.max(1, lotSize || 1);
  return Math.ceil(quantity / safeLot) * safeLot;
}

export function explodeBom(rootItemId: string, quantity: number, bom: BomComponent[], stock: StockBalance, items: ItemMaster[]): Requirement[] {
  if (quantity <= 0) throw new Error('Quantidade da ordem deve ser positiva');
  assertNoBomCycle(rootItemId, bom);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const grossByComponent = new Map<string, number>();
  const queue = [{ itemId: rootItemId, quantity }];

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const component of bom.filter((entry) => entry.active && entry.parentItemId === current.itemId)) {
      const required = current.quantity * component.quantityPer;
      grossByComponent.set(component.componentItemId, (grossByComponent.get(component.componentItemId) || 0) + required);
      queue.push({ itemId: component.componentItemId, quantity: required });
    }
  }

  return Array.from(grossByComponent.entries()).map(([componentItemId, grossRequirement]) => {
    const item = itemById.get(componentItemId);
    const available = stock[componentItemId] || 0;
    const safetyStock = item?.safetyStock || 0;
    const netRequirement = Math.max(0, grossRequirement + safetyStock - available);
    const plannedOrderQty = roundToLot(netRequirement, item?.lotSize || 1);
    return {
      componentItemId,
      grossRequirement,
      available,
      safetyStock,
      netRequirement,
      shortage: netRequirement,
      lotSize: item?.lotSize || 1,
      plannedOrderQty,
      leadTimeDays: item?.leadTimeDays || 0,
      releaseOffsetDays: item?.leadTimeDays || 0,
    };
  });
}

export function transitionOrder(current: ProductionStatus, event: ProductionEvent): ProductionStatus {
  const transitions: Record<ProductionStatus, Partial<Record<ProductionEvent, ProductionStatus>>> = {
    DRAFT: { VALIDATE: 'VALIDATED', CANCEL: 'CANCELLED' },
    VALIDATED: { START: 'IN_PRODUCTION', CANCEL: 'CANCELLED' },
    IN_PRODUCTION: { FINISH: 'DONE' },
    DONE: {},
    CANCELLED: {},
  };
  const next = transitions[current][event];
  if (!next) throw new Error('Transição inválida da máquina de estados');
  return next;
}

export function reserveAndConsumeStock(stock: StockBalance, componentItemId: string, quantity: number): StockBalance {
  const current = stock[componentItemId] || 0;
  const nextBalance = current - quantity;
  if (nextBalance < 0) throw new Error('Estoque nunca pode ficar negativo');
  return { ...stock, [componentItemId]: nextBalance };
}

export function consume(stock: StockBalance, componentItemId: string, quantity: number): StockBalance {
  return reserveAndConsumeStock(stock, componentItemId, quantity);
}
`;
}

function schemaContent() {
  return `import { z } from 'zod';

export const itemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1),
  leadTimeDays: z.number().int().min(0),
  lotSize: z.number().int().positive(),
  safetyStock: z.number().int().min(0),
});

export const bomComponentSchema = z.object({
  parentItemId: z.string().min(1),
  componentItemId: z.string().min(1),
  quantityPer: z.number().positive(),
  revision: z.string().min(1),
  active: z.boolean().default(true),
});

export const productionOrderSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  actor: z.string().min(1),
  origin: z.string().min(1),
});
`;
}

function serviceContent() {
  return `import { addDays, formatISO } from 'date-fns';
import {
  appendAudit,
  createSeedData,
  explodeBom,
  transitionOrder,
  type AuditEntry,
  type BomComponent,
  type ItemMaster,
  type ProductionEvent,
  type ProductionStatus,
  type StockBalance,
} from '../../domain/mrp';
import { bomComponentSchema, productionOrderSchema } from '../../schemas/mrp_schema';

export function buildProductionPlan(input: {
  orderId: string;
  itemId: string;
  quantity: number;
  actor: string;
  origin: string;
  bom?: BomComponent[];
  stock?: StockBalance;
  items?: ItemMaster[];
}) {
  const parsed = productionOrderSchema.parse(input);
  const seed = createSeedData();
  const activeBom = input.bom || seed.bom;
  const stock = input.stock || seed.stock;
  const items = input.items || seed.items;
  const before = { orderId: input.orderId, status: 'DRAFT', stock };
  const requirements = explodeBom(parsed.itemId, parsed.quantity, activeBom, stock, items);
  const after = {
    orderId: input.orderId,
    status: 'VALIDATED',
    requirements,
    suggestedPurchaseDate: formatISO(addDays(new Date('2026-06-01T12:00:00.000Z'), -Math.max(...requirements.map((row) => row.releaseOffsetDays), 0))),
  };
  const auditEntry: AuditEntry = {
    id: \`\${input.orderId}-MRP_RUN\`,
    entity: 'ProductionOrder',
    entityId: input.orderId,
    action: 'MRP_RUN',
    actor: parsed.actor,
    origin: parsed.origin,
    before,
    after,
    payload: { itemId: parsed.itemId, quantity: parsed.quantity },
    timestamp: new Date('2026-06-01T12:00:00.000Z').toISOString(),
  };
  return { ...after, auditLog: appendAudit([], auditEntry), items, bom: activeBom, stock };
}

export function createBomRevisionDraft(input: unknown) {
  return bomComponentSchema.parse(input);
}

export function transitionOrderAction(current: ProductionStatus, event: ProductionEvent): ProductionStatus {
  return transitionOrder(current, event);
}
`;
}

function storeContent() {
  return `import { create } from 'zustand';
import type { ProductionStatus } from '../domain/mrp';

type ForgeMrpState = {
  selectedOrderId: string;
  status: ProductionStatus;
  setStatus: (status: ProductionStatus) => void;
};

export const useForgeMrpStore = create<ForgeMrpState>((set) => ({
  selectedOrderId: 'OP-2026-014',
  status: 'DRAFT',
  setStatus: (status) => set({ status }),
}));
`;
}

function pageContent() {
  return `'use client';

import { useEffect, useMemo, useState } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { createSeedData, type AuditEntry, type BomComponent, type ItemMaster, type ProductionEvent, type ProductionStatus, type Requirement, type StockBalance } from '../src/domain/mrp';
import {
  buildProductionPlan,
  createBomRevisionDraft,
  transitionOrderAction,
} from '../src/services/use-cases/mrp_service';
import { useForgeMrpStore } from '../src/store/mrp_store';

type BomForm = {
  parentItemId: string;
  componentItemId: string;
  quantityPer: number;
  revision: string;
  active: boolean;
};

type ForgeSnapshot = {
  items: ItemMaster[];
  bom: BomComponent[];
  stock: StockBalance;
  order: { id: string; code: string; itemId: string; quantity: number; status: ProductionStatus } | null;
  auditLog: AuditEntry[];
};

const statusLabel: Record<ProductionStatus, string> = {
  DRAFT: 'Rascunho',
  VALIDATED: 'Validado',
  IN_PRODUCTION: 'Em Produção',
  DONE: 'Finalizado',
  CANCELLED: 'Cancelado',
};

const actionButtonClass = 'max-w-full rounded-md px-4 py-2 text-left font-extrabold whitespace-normal disabled:cursor-not-allowed disabled:opacity-45';
const seedData = createSeedData();
const fallbackSnapshot: ForgeSnapshot = {
  items: seedData.items,
  bom: seedData.bom,
  stock: seedData.stock,
  order: { id: 'OP-2026-014', code: 'OP-2026-014', itemId: 'ASM-900', quantity: 4, status: 'DRAFT' },
  auditLog: [],
};

export default function ForgeMrpPage() {
  const selectedOrderId = useForgeMrpStore((state) => state.selectedOrderId);
  const storeStatus = useForgeMrpStore((state) => state.status);
  const setStoreStatus = useForgeMrpStore((state) => state.setStatus);
  const [snapshot, setSnapshot] = useState<ForgeSnapshot>(fallbackSnapshot);
  const [quantityDraft, setQuantityDraft] = useState(4);
  const [plannedQuantity, setPlannedQuantity] = useState(4);
  const [mrpRunCount, setMrpRunCount] = useState(1);
  const [status, setStatus] = useState<ProductionStatus>(storeStatus);
  const [bomDraft, setBomDraft] = useState('ASM-900 -> FRM-100 x1 | revisão A');
  const [bomError, setBomError] = useState('');
  const [backendStatus, setBackendStatus] = useState('Conectando Postgres local...');
  const [orderMessage, setOrderMessage] = useState('MRP executado para 4 un. de ASM-900.');
  const orderId = snapshot.order?.id || selectedOrderId;

  function applySnapshot(nextSnapshot: ForgeSnapshot) {
    setSnapshot(nextSnapshot);
    const nextStatus = nextSnapshot.order?.status || 'DRAFT';
    setStatus(nextStatus);
    setStoreStatus(nextStatus);
  }

  async function loadSnapshot() {
    try {
      const response = await fetch('/api/forge/snapshot', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Falha ao carregar snapshot.');
      applySnapshot(data.snapshot);
      setBackendStatus('Postgres conectado');
    } catch (error) {
      setBackendStatus('Backend local indisponível: execute Docker/Postgres, migrations e seed.');
      setOrderMessage(error instanceof Error ? error.message : 'Falha ao carregar backend local.');
    }
  }

  useEffect(() => {
    loadSnapshot();
  }, []);

  const plan = useMemo(
    () => buildProductionPlan({
      orderId,
      itemId: 'ASM-900',
      quantity: plannedQuantity,
      actor: 'eduardo@forge.local',
      origin: mrpRunCount === 1 ? 'ui/manual-smoke' : 'ui/run-mrp',
      bom: snapshot.bom,
      stock: snapshot.stock,
      items: snapshot.items,
    }),
    [mrpRunCount, orderId, plannedQuantity, snapshot.bom, snapshot.items, snapshot.stock]
  );
  const visibleAuditLog = useMemo<ReadonlyArray<AuditEntry>>(
    () => snapshot.auditLog.length ? snapshot.auditLog : plan.auditLog,
    [plan.auditLog, snapshot.auditLog]
  );
  const bomForm = useForm<BomForm>({
    defaultValues: {
      parentItemId: 'ASM-900',
      componentItemId: 'FRM-100',
      quantityPer: 1,
      revision: 'A',
      active: true,
    },
  });
  const columns = useMemo<ColumnDef<Requirement>[]>(
    () => [
      { accessorKey: 'componentItemId', header: 'Componente' },
      { accessorKey: 'grossRequirement', header: 'Necessidade bruta' },
      { accessorKey: 'available', header: 'Saldo' },
      { accessorKey: 'safetyStock', header: 'Segurança' },
      { accessorKey: 'shortage', header: 'Faltante' },
      { accessorKey: 'plannedOrderQty', header: 'Sugestão compra' },
      { accessorKey: 'leadTimeDays', header: 'Lead time' },
    ],
    []
  );
  const table = useReactTable({
    data: plan.requirements,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  async function advance(event: ProductionEvent) {
    try {
      transitionOrderAction(status, event);
      const response = await fetch('/api/forge/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, event }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Transição não permitida nesta etapa.');
      applySnapshot(data.snapshot);
      const next = data.snapshot.order?.status || status;
      setOrderMessage('Status da ordem: ' + statusLabel[next as ProductionStatus] + '.');
      setBackendStatus('Postgres conectado');
    } catch (error) {
      setOrderMessage(error instanceof Error ? error.message : 'Transição não permitida nesta etapa.');
    }
  }

  async function runMrp() {
    const nextQuantity = Math.max(1, Number(quantityDraft) || 1);
    try {
      const response = await fetch('/api/forge/mrp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          itemId: 'ASM-900',
          quantity: nextQuantity,
          actor: 'eduardo@forge.local',
          origin: 'ui/run-mrp',
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Falha ao executar MRP.');
      applySnapshot(data.snapshot);
      setQuantityDraft(nextQuantity);
      setPlannedQuantity(nextQuantity);
      setMrpRunCount((current) => current + 1);
      setBackendStatus('Postgres conectado');
      setOrderMessage('MRP persistido para ' + nextQuantity + ' un. de ASM-900.');
    } catch (error) {
      setOrderMessage(error instanceof Error ? error.message : 'Falha ao executar MRP.');
    }
  }

  async function saveBomDraft(values: BomForm) {
    try {
      const draft = createBomRevisionDraft(values);
      const response = await fetch('/api/forge/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Falha ao salvar BOM.');
      applySnapshot(data.snapshot);
      setBomDraft(draft.parentItemId + ' -> ' + draft.componentItemId + ' x' + draft.quantityPer + ' | revisão ' + draft.revision);
      setBomError('');
      setMrpRunCount((current) => current + 1);
      setBackendStatus('Postgres conectado');
      setOrderMessage('BOM persistida e MRP recalculado com a revisão ativa.');
    } catch (error) {
      setBomError(error instanceof Error ? error.message : 'Quantidade do componente deve ser maior que zero.');
      setBomDraft('BOM não alterada: revise os campos antes de salvar.');
    }
  }

  async function removeBomDraft() {
    const values = { ...bomForm.getValues(), active: false };
    try {
      const response = await fetch('/api/forge/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Falha ao remover componente.');
      applySnapshot(data.snapshot);
      setBomDraft(values.parentItemId + ' -> ' + values.componentItemId + ' removido da revisão ' + values.revision);
      setBackendStatus('Postgres conectado');
      setOrderMessage('Componente removido da BOM ativa e MRP recalculado.');
    } catch (error) {
      setBomDraft(error instanceof Error ? error.message : 'Falha ao remover componente.');
    }
    setBomError('');
    setMrpRunCount((current) => current + 1);
  }

  const canValidate = status === 'DRAFT';
  const canStart = status === 'VALIDATED';
  const canFinish = status === 'IN_PRODUCTION';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid min-w-0 max-w-[1440px] gap-6 px-4 py-6 sm:px-5 lg:grid-cols-[260px_1fr]">
        <aside className="sticky top-6 h-fit min-w-0 rounded-lg border border-slate-800 bg-slate-900/92 p-5 shadow-2xl shadow-black/20">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">Forge MRP</p>
          <h1 className="mt-3 text-2xl font-extrabold">Control Room</h1>
          <nav className="mt-8 grid gap-2 text-sm font-semibold text-slate-300">
            {['Itens', 'BOM', 'Estoque', 'Ordens', 'MRP', 'Auditoria'].map((item) => (
              <a key={item} className="rounded-md border border-slate-800 px-3 py-2 hover:border-emerald-400 hover:text-white" href={\`#\${item.toLowerCase()}\`}>
                {item}
              </a>
            ))}
          </nav>
        </aside>

        <section className="grid min-w-0 gap-6">
          <header className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-emerald-300">Planejamento determinístico</p>
                <h2 className="mt-2 text-3xl font-extrabold md:text-5xl">Forge MRP operacional</h2>
                <p className="mt-3 max-w-3xl text-base text-slate-300">
                  Itens, BOM multinível, estoque auditável, ordens com máquina de estados, explosão de necessidades e audit log append-only.
                </p>
                <p className="mt-3 text-sm font-bold text-emerald-200">{backendStatus}</p>
              </div>
              <div className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-200">
                Ordem {orderId}: {statusLabel[status]}
              </div>
            </div>
          </header>

          <section className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <span className="text-xs font-bold uppercase text-slate-400">KPI ordens abertas</span>
              <strong className="mt-2 block text-3xl">{status === 'DONE' ? 0 : 7}</strong>
            </article>
            <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <span className="text-xs font-bold uppercase text-slate-400">Necessidades críticas</span>
              <strong className="mt-2 block text-3xl">{plan.requirements.filter((row) => row.shortage > 0).length}</strong>
            </article>
            <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <span className="text-xs font-bold uppercase text-slate-400">Sugestões de compra</span>
              <strong className="mt-2 block text-3xl">{plan.requirements.reduce((sum, row) => sum + row.plannedOrderQty, 0)}</strong>
            </article>
            <article className="min-w-0 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <span className="text-xs font-bold uppercase text-slate-400">Auditoria</span>
              <strong className="mt-2 block text-3xl">{visibleAuditLog.length} MRP_RUN</strong>
            </article>
          </section>

          <section id="bom" className="grid min-w-0 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <form
              className="grid min-w-0 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-5"
              onSubmit={bomForm.handleSubmit(saveBomDraft)}
            >
              <h3 className="text-xl font-extrabold">Cadastro operacional de BOM</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-slate-300">
                  Item pai
                  <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" {...bomForm.register('parentItemId')} />
                </label>
                <label className="grid gap-1 text-sm font-semibold text-slate-300">
                  Item componente
                  <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" {...bomForm.register('componentItemId')} />
                </label>
                <label className="grid gap-1 text-sm font-semibold text-slate-300">
                  Quantidade por unidade
                  <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" type="number" step="0.01" {...bomForm.register('quantityPer', { valueAsNumber: true })} />
                </label>
                <label className="grid gap-1 text-sm font-semibold text-slate-300">
                  Revisão ativa
                  <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" {...bomForm.register('revision')} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="max-w-full rounded-md bg-emerald-400 px-4 py-2 text-left font-extrabold whitespace-normal text-slate-950" type="submit">Adicionar componente BOM</button>
                <button className="max-w-full rounded-md border border-slate-700 px-4 py-2 text-left font-bold whitespace-normal" type="button" onClick={() => setBomDraft('Revisão A editada e pronta para validação')}>Editar revisão ativa</button>
                <button className="max-w-full rounded-md border border-rose-500/50 px-4 py-2 text-left font-bold whitespace-normal text-rose-200" type="button" onClick={removeBomDraft}>Remover componente</button>
              </div>
              {bomError ? <p className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100">{bomError}</p> : null}
              <p className="max-w-full rounded-md bg-slate-950 px-3 py-2 text-sm text-slate-300 break-words">{bomDraft}</p>
            </form>

            <section id="ordens" className="grid min-w-0 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-xl font-extrabold">Ordem de produção e MRP</h3>
              <label className="grid gap-1 text-sm font-semibold text-slate-300">
                Quantidade ASM-900
                <input className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" type="number" min="1" value={quantityDraft} onChange={(event) => setQuantityDraft(Number(event.target.value) || 1)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className={\`\${actionButtonClass} bg-sky-400 text-slate-950\`} type="button" disabled={!canValidate} onClick={() => advance('VALIDATE')}>Validar ordem</button>
                <button className={\`\${actionButtonClass} bg-amber-300 text-slate-950\`} type="button" disabled={!canStart} onClick={() => advance('START')}>Iniciar produção</button>
                <button className={\`\${actionButtonClass} bg-emerald-400 text-slate-950\`} type="button" disabled={!canFinish} onClick={() => advance('FINISH')}>Finalizar</button>
                <button className="max-w-full rounded-md border border-slate-700 px-4 py-2 text-left font-bold whitespace-normal" type="button" onClick={runMrp}>Executar MRP</button>
              </div>
              <p className="max-w-full rounded-md bg-slate-950 px-3 py-2 text-sm text-slate-300 break-words">{orderMessage}</p>
            </section>
          </section>

          <section id="mrp" className="min-w-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
              <h3 className="text-xl font-extrabold">Tabela TanStack de necessidades</h3>
              <span className="text-sm text-slate-400">React Hook Form + TanStack Table + Zustand ativos</span>
            </div>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead className="bg-slate-950 text-xs uppercase text-slate-400">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="px-4 py-3">{flexRender(header.column.columnDef.header, header.getContext())}</th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-800">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="auditoria" className="grid min-w-0 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
            <h3 className="text-xl font-extrabold">Audit log imutável</h3>
            {visibleAuditLog.map((entry) => (
              <article key={entry.id} className="min-w-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950 p-4 text-sm">
                <strong>{entry.action}</strong> por {entry.actor} via {entry.origin}
                <pre className="mt-3 max-w-full overflow-x-auto text-[11px] text-slate-400">{JSON.stringify({ before: entry.before, after: entry.after, payload: entry.payload }, null, 2)}</pre>
              </article>
            ))}
          </section>
        </section>
      </div>
    </main>
  );
}
`;
}

function globalsContent() {
  return `@import "tailwindcss";

:root {
  color-scheme: dark;
  --font-assistant: 'Assistant', system-ui, sans-serif;
  --color-bg: #020617;
  --color-ink: #f8fafc;
  --color-muted: #94a3b8;
  --color-accent: #22c55e;
  --color-line: rgba(148, 163, 184, 0.28);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.86), rgba(2, 6, 23, 1)),
    var(--color-bg);
  color: var(--color-ink);
  font-family: var(--font-assistant), 'Assistant', system-ui, sans-serif;
}

input,
button,
table,
textarea,
select {
  font: inherit;
  max-width: 100%;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  cursor: pointer;
}

@media (max-width: 760px) {
  main {
    overflow-x: hidden;
  }

  table {
    font-size: 13px;
  }
}
`;
}

function tailwindConfigContent() {
  return `import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        assistant: ['var(--font-assistant)', 'Assistant', 'system-ui', 'sans-serif'],
      },
    },
  },
};

export default config;
`;
}

function postcssConfigContent() {
  return `module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;
}

function tsconfigContent() {
  return json({
    compilerOptions: {
      target: 'ES2020',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: false,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  });
}

function vitestConfigContent() {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
`;
}

function playwrightConfigContent() {
  return `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3210',
    url: 'http://127.0.0.1:3210',
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: 'http://127.0.0.1:3210',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
  },
});
`;
}

function vitestTestContent() {
  return `import { describe, expect, test } from 'vitest';
import {
  appendAudit,
  assertNoBomCycle,
  createSeedData,
  explodeBom,
  reserveAndConsumeStock,
  transitionOrder,
} from '../src/domain/mrp';
import { bomComponentSchema } from '../src/schemas/mrp_schema';
import { buildProductionPlan } from '../src/services/use-cases/mrp_service';

describe('Forge MRP rules', () => {
  test('explode BOM multinível e calcula faltante exato com lote, lead time e estoque de segurança', () => {
    const seed = createSeedData();
    const result = explodeBom('ASM-900', 2, seed.bom, { 'FRM-100': 0, 'MTR-001': 1, 'SCR-050': 0 }, seed.items);
    expect(result.find((row) => row.componentItemId === 'FRM-100')?.shortage).toBe(4);
    expect(result.find((row) => row.componentItemId === 'MTR-001')?.grossRequirement).toBe(4);
    expect(result.find((row) => row.componentItemId === 'SCR-050')?.grossRequirement).toBe(48);
    expect(result.find((row) => row.componentItemId === 'SCR-050')?.plannedOrderQty).toBe(100);
  });

  test('bloqueia saldo negativo de estoque', () => {
    expect(() => reserveAndConsumeStock({ 'MTR-001': 1 }, 'MTR-001', 2)).toThrow(/negativo/);
  });

  test('usa BOM ativa recebida da UI para recalcular MRP', () => {
    const seed = createSeedData();
    const customBom = seed.bom.map((component) => (
      component.parentItemId === 'ASM-900' && component.componentItemId === 'FRM-100'
        ? { ...component, quantityPer: 2 }
        : component
    ));
    const plan = buildProductionPlan({
      orderId: 'OP-TEST',
      itemId: 'ASM-900',
      quantity: 4,
      actor: 'test',
      origin: 'vitest',
      bom: customBom,
    });
    expect(plan.requirements.find((row) => row.componentItemId === 'FRM-100')?.grossRequirement).toBe(8);
    expect(plan.requirements.find((row) => row.componentItemId === 'SCR-050')?.grossRequirement).toBe(192);
  });

  test('bloqueia transição inválida da máquina de estados', () => {
    expect(() => transitionOrder('DONE', 'VALIDATE')).toThrow(/inválida/);
  });

  test('detecta ciclo de BOM circular', () => {
    expect(() => assertNoBomCycle('A', [
      { parentItemId: 'A', componentItemId: 'B', quantityPer: 1, revision: 'A', active: true },
      { parentItemId: 'B', componentItemId: 'A', quantityPer: 1, revision: 'A', active: true },
    ])).toThrow(/Ciclo/);
  });

  test('mantém audit log imutável com before after actor origin', () => {
    const mutableBefore = { status: 'DRAFT', stock: { 'ASM-900': 1 } };
    const audit = appendAudit([], {
      id: '1',
      entity: 'Order',
      entityId: 'OP-1',
      action: 'MRP_RUN',
      actor: 'planner',
      origin: 'ui',
      before: mutableBefore,
      after: { status: 'VALIDATED' },
      payload: { itemId: 'ASM-900' },
      timestamp: '2026-06-01T12:00:00.000Z',
    });
    mutableBefore.stock['ASM-900'] = 99;
    const before = audit[0].before as { status: string; stock: { 'ASM-900': number } };
    expect(Object.isFrozen(audit)).toBe(true);
    expect(Object.isFrozen(audit[0])).toBe(true);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.stock)).toBe(true);
    expect(before.stock['ASM-900']).toBe(1);
    expect(() => {
      before.stock['ASM-900'] = 2;
    }).toThrow();
    expect(audit[0].after).toEqual({ status: 'VALIDATED' });
  });

  test('valida schema Zod de componente BOM', () => {
    expect(() => bomComponentSchema.parse({ parentItemId: 'A', componentItemId: 'B', quantityPer: 0, revision: 'A', active: true })).toThrow();
  });
});
`;
}

function playwrightTestContent() {
  return `import { expect, test } from '@playwright/test';

test('Forge MRP smoke visual operacional', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Forge MRP operacional/i })).toBeVisible();
  await expect(page.getByText(/Postgres conectado/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Adicionar componente BOM/i })).toBeVisible();
  await expect(page.getByText(/Audit log imutável/i)).toBeVisible();

  await page.getByLabel(/Quantidade por unidade/i).fill('0');
  await page.getByRole('button', { name: /Adicionar componente BOM/i }).click();
  await expect(page.getByText(/Quantidade do componente deve ser maior que zero/i)).toBeVisible();
  expect(pageErrors).toEqual([]);

  await page.getByLabel(/Quantidade por unidade/i).fill('2');
  await page.getByRole('button', { name: /Adicionar componente BOM/i }).click();
  await page.getByRole('button', { name: /Executar MRP/i }).click();
  await expect(page.getByRole('row').filter({ hasText: 'FRM-100' })).toContainText('8');
  await expect(page.getByRole('row').filter({ hasText: 'SCR-050' })).toContainText('192');
  await page.reload();
  await expect(page.getByText(/Postgres conectado/i)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'FRM-100' })).toContainText('8');
  await expect(page.getByRole('row').filter({ hasText: 'SCR-050' })).toContainText('192');
  expect(pageErrors).toEqual([]);
});
`;
}

function buildForgeMrpOperations() {
  return [
    { op: 'write_file', path: 'package.json', content: packageJsonContent() },
    { op: 'write_file', path: 'docker-compose.yml', content: dockerComposeContent() },
    { op: 'write_file', path: '.env.example', content: envContent() },
    { op: 'write_file', path: 'next.config.ts', content: nextConfigContent() },
    { op: 'write_file', path: 'tsconfig.json', content: tsconfigContent() },
    { op: 'write_file', path: 'tailwind.config.ts', content: tailwindConfigContent() },
    { op: 'write_file', path: 'postcss.config.js', content: postcssConfigContent() },
    { op: 'write_file', path: 'vitest.config.ts', content: vitestConfigContent() },
    { op: 'write_file', path: 'playwright.config.ts', content: playwrightConfigContent() },
    { op: 'write_file', path: 'prisma/schema.prisma', content: prismaSchemaContent() },
    { op: 'write_file', path: 'prisma/migrations/202606110001_init/migration.sql', content: prismaMigrationContent() },
    { op: 'write_file', path: 'scripts/seed.mjs', content: seedScriptContent() },
    { op: 'write_file', path: 'scripts/db-check.mjs', content: dbCheckScriptContent() },
    { op: 'write_file', path: 'app/layout.tsx', content: layoutContent() },
    { op: 'write_file', path: 'app/page.tsx', content: pageContent() },
    { op: 'write_file', path: 'app/api/forge/snapshot/route.ts', content: snapshotRouteContent() },
    { op: 'write_file', path: 'app/api/forge/bom/route.ts', content: bomRouteContent() },
    { op: 'write_file', path: 'app/api/forge/mrp/route.ts', content: mrpRouteContent() },
    { op: 'write_file', path: 'app/api/forge/order/route.ts', content: orderRouteContent() },
    { op: 'write_file', path: 'app/globals.css', content: globalsContent() },
    { op: 'write_file', path: 'src/domain/mrp.ts', content: domainContent() },
    { op: 'write_file', path: 'src/schemas/mrp_schema.ts', content: schemaContent() },
    { op: 'write_file', path: 'src/services/use-cases/mrp_service.ts', content: serviceContent() },
    { op: 'write_file', path: 'src/server/prisma.ts', content: prismaClientContent() },
    { op: 'write_file', path: 'src/server/forge_repository.ts', content: repositoryContent() },
    { op: 'write_file', path: 'src/store/mrp_store.ts', content: storeContent() },
    { op: 'write_file', path: 'tests/mrp.test.ts', content: vitestTestContent() },
    { op: 'write_file', path: 'tests/forge-mrp.spec.ts', content: playwrightTestContent() },
  ];
}

function buildForgeMrpOperationBatch({
  projectInfo = {},
  userMessage = '',
  attachments = [],
  executionIntent = 'edit_project',
  buildOperationBatchDiffPreview = () => '',
  evaluateOperationBatchArtifactQuality = null,
  contextText = '',
  workGraph = null,
  providerFailure = null,
  raw = 'forge_mrp_blueprint:deterministic',
} = {}) {
  const operations = buildForgeMrpOperations();
  const artifactQuality = typeof evaluateOperationBatchArtifactQuality === 'function'
    ? evaluateOperationBatchArtifactQuality({
        operations,
        projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
        userMessage,
        executionIntent,
        contextText,
        workGraph,
      })
    : null;
  const action = {
    type: 'operation_batch',
    intent: executionIntent === 'init_project' ? 'init_project' : 'edit_project',
    rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
    targetFile: 'app/page.tsx',
    operations,
    diffPreview: buildOperationBatchDiffPreview(operations),
    summary: 'Forge MRP determinístico com Prisma/Postgres, domínio, MRP multinível, audit log, testes e UI escura Assistant.',
    userMessage,
    attachments,
    generatedBy: 'forge_mrp_blueprint_service',
  };
  if (artifactQuality && artifactQuality.enabled) action.artifactQuality = artifactQuality;
  return {
    ok: true,
    action,
    artifactQuality: artifactQuality && artifactQuality.enabled ? artifactQuality : null,
    providerFailure: providerFailure || undefined,
    raw,
  };
}

module.exports = {
  buildForgeMrpOperationBatch,
  buildForgeMrpOperations,
  isForgeMrpRequest,
};
