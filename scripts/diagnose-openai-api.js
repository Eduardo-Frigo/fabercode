#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

let electron = null;
try {
  electron = require('electron');
} catch {
  electron = null;
}

if (!process.versions.electron || !electron || !electron.app) {
  console.error('Use: npm run diagnose:openai');
  console.error('Este diagnóstico precisa rodar pelo Electron para ler chaves protegidas pelo safeStorage.');
  process.exit(2);
}

const { app, safeStorage } = electron;
const { extractOpenAiResponsesText, resolveOpenAiBaseUrl } = require('../cortex/providers/remote_clients');

function parseArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function loadDotenv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  try {
    require('dotenv').config({ path: envPath, quiet: true });
  } catch {
    // dotenv é auxiliar; o diagnóstico também funciona só com settings/env já carregado.
  }
}

function unprotectSecret(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';

  if (text.startsWith('plain:v1:')) {
    try {
      return Buffer.from(text.slice('plain:v1:'.length), 'base64').toString('utf8').trim();
    } catch {
      return '';
    }
  }

  if (text.startsWith('enc:v1:')) {
    if (
      !safeStorage ||
      typeof safeStorage.isEncryptionAvailable !== 'function' ||
      !safeStorage.isEncryptionAvailable() ||
      typeof safeStorage.decryptString !== 'function'
    ) {
      return '';
    }
    try {
      return safeStorage.decryptString(Buffer.from(text.slice('enc:v1:'.length), 'base64')).trim();
    } catch {
      return '';
    }
  }

  return text;
}

function maskSecret(value = '') {
  const text = String(value || '').trim();
  if (!text) return 'none';
  return `${text.slice(0, 7)}...${text.slice(-4)} (${text.length})`;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
    text,
  };
}

function compactError(json, text = '') {
  const error = json && json.error ? json.error : null;
  if (error && typeof error === 'object') {
    return {
      message: error.message || '',
      type: error.type || '',
      code: error.code || '',
      param: error.param || '',
    };
  }
  return String(text || '').replace(/\s+/g, ' ').slice(0, 360);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  loadDotenv(rootDir);

  app.setName('Faber Code');
  await app.whenReady();

  const settingsPath = args.settings || path.join(os.homedir(), 'Library/Application Support/Faber Code/ai-runtime-settings.json');
  const settings = readJson(settingsPath);
  const settingsKey = unprotectSecret(settings.openaiApiKey || '');
  const envKey = String(process.env.OPENAI_API_KEY || '').trim();
  const apiKey = settingsKey || envKey;
  const keySource = settingsKey ? 'settings' : envKey ? 'env' : 'none';
  const model = String(args.model || settings.openaiModel || process.env.OPENAI_MODEL_BRAIN || 'gpt-5-codex').trim();
  const baseUrl = resolveOpenAiBaseUrl(String(args.baseUrl || process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'));
  const prompt = String(args.prompt || 'Responda exatamente com a palavra OK.');

  const report = {
    settingsPath,
    selectedProvider: settings.selectedProvider || '',
    keySource,
    key: maskSecret(apiKey),
    model,
    baseUrl,
    safeStorageEncryptionAvailable: Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()),
    checks: [],
  };

  if (!apiKey) {
    report.checks.push({
      name: 'credentials',
      ok: false,
      message: 'Nenhuma chave OpenAI legível foi encontrada em settings ou .env.',
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    app.quit();
    return;
  }

  const modelCheck = await fetchJson(`${baseUrl}/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  report.checks.push({
    name: 'model_lookup',
    ok: modelCheck.ok,
    status: modelCheck.status,
    id: modelCheck.json && modelCheck.json.id ? modelCheck.json.id : null,
    error: modelCheck.ok ? null : compactError(modelCheck.json, modelCheck.text),
  });

  const responseBody = {
    model,
    input: prompt,
    max_output_tokens: 256,
  };
  const responseCheck = await fetchJson(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(responseBody),
  });
  const outputText = responseCheck.json ? extractOpenAiResponsesText(responseCheck.json) : '';
  report.checks.push({
    name: 'responses_smoke',
    ok: responseCheck.ok && Boolean(outputText),
    status: responseCheck.status,
    responseStatus: responseCheck.json && responseCheck.json.status ? responseCheck.json.status : null,
    outputText,
    outputTextLength: outputText.length,
    incompleteDetails: responseCheck.json && responseCheck.json.incomplete_details ? responseCheck.json.incomplete_details : null,
    error: responseCheck.ok ? null : compactError(responseCheck.json, responseCheck.text),
  });

  console.log(JSON.stringify(report, null, 2));
  app.quit();
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error && error.message ? error.message : String(error || ''),
  }, null, 2));
  process.exitCode = 1;
  app.quit();
});
