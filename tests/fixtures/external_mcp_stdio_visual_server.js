const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { PNG } = require('pngjs');

function writePng(filePath, { width = 720, height = 405 } = {}) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const inHeader = y < 76;
      const inHero = y >= 104 && y < 270 && x > 48 && x < width - 48;
      const inProof = y >= 300 && y < 370 && x > 96 && x < width - 96;
      png.data[idx] = inHeader ? 13 : inHero ? 36 : inProof ? 241 : 6;
      png.data[idx + 1] = inHeader ? 42 : inHero ? 132 : inProof ? 190 : 12;
      png.data[idx + 2] = inHeader ? 76 : inHero ? 116 : inProof ? 84 : 27;
      png.data[idx + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

function handleRequest(message) {
  if (!message || !message.id || !message.method) return;
  if (message.method === 'initialize') {
    respond(message.id, {
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'Faber Visual Fixture MCP', version: '1.0.0' },
      capabilities: { tools: {} },
    });
    return;
  }
  if (message.method === 'tools/list') {
    respond(message.id, {
      tools: [
        {
          name: 'visual.capture',
          description: 'Captura uma evidencia visual PNG e DOM metrics.',
          inputSchema: { type: 'object' },
          annotations: { permission: 'write' },
        },
        {
          name: 'filesystem.write',
          description: 'Tool de escrita direta que deve ser bloqueada pelo Faber.',
          inputSchema: { type: 'object' },
          annotations: { permission: 'write' },
        },
      ],
    });
    return;
  }
  if (message.method === 'tools/call') {
    const params = message.params || {};
    if (params.name !== 'visual.capture') {
      respondError(message.id, -32601, `Tool nao suportada no fixture: ${params.name || '<vazia>'}`);
      return;
    }
    const args = params.arguments || {};
    const projectSession = args.projectSession || {};
    const rootPath = String(projectSession.rootPath || '');
    const artifactPath = String(args.artifactPath || path.join(rootPath, '.faber', 'external-mcp-artifacts', 'stdio-visual-capture.png'));
    writePng(artifactPath);
    respond(message.id, {
      content: [
        { type: 'text', text: 'stdio visual capture complete' },
        { type: 'image', mimeType: 'image/png', path: artifactPath },
      ],
      structuredContent: {
        domMetrics: [
          {
            label: 'desktop',
            innerWidth: 1365,
            hamburgerVisible: false,
            desktopNavVisible: true,
            hasHorizontalOverflow: false,
            hasOldMemory: false,
          },
          {
            label: 'tablet',
            innerWidth: 820,
            hamburgerVisible: true,
            desktopNavVisible: false,
            hasHorizontalOverflow: false,
            hasOldMemory: false,
          },
          {
            label: 'mobile',
            innerWidth: 390,
            hamburgerVisible: true,
            desktopNavVisible: false,
            hasHorizontalOverflow: false,
            hasOldMemory: false,
          },
        ],
      },
      artifacts: [artifactPath],
    });
    return;
  }
  respondError(message.id, -32601, `Metodo nao suportado no fixture: ${message.method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    handleRequest(JSON.parse(line));
  } catch (error) {
    process.stderr.write(`fixture_parse_error:${error.message}\n`);
  }
});
