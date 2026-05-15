const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const ignoredDirs = new Set([
  '.git',
  '.next',
  '.venv-mempalace',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'private_context',
  'release',
  'tmp',
  'temp',
]);

const ignoredFiles = new Set([
  '.env',
  'entities.json',
  'mempalace.yaml',
]);

const binaryExtensions = new Set([
  '.avif',
  '.gif',
  '.icns',
  '.ico',
  '.jpg',
  '.jpeg',
  '.pdf',
  '.png',
  '.webp',
  '.zip',
]);

const checks = [
  {
    label: 'absolute local user path',
    pattern: /\/Users\/[A-Za-z0-9._-]+/i,
  },
  {
    label: 'known private domain or organization',
    pattern: new RegExp(`\\b(${['flying', 'whale'].join('')}|${['cerne', 'flying', 'whale'].join('\\.')})\\b`, 'i'),
  },
  {
    label: 'known private Supabase project id',
    pattern: new RegExp(`\\b${['wdwphenm', 'feawubd', 'cfmub'].join('')}\\b`, 'i'),
  },
  {
    label: 'known private deployment scope',
    pattern: new RegExp(`\\b${['eduardo', 'frigos', 'projects'].join('-')}\\b`, 'i'),
  },
  {
    label: 'OpenAI style API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    label: 'Google/Gemini style API key',
    pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/,
  },
  {
    label: 'GitHub token',
    pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
  },
  {
    label: 'Vercel token',
    pattern: /\bvercel_[A-Za-z0-9]{20,}\b/i,
  },
  {
    label: 'private key block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
];

function runGitLsFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function walk(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolutePath, relativePath));
    } else if (entry.isFile()) {
      if (ignoredFiles.has(relativePath)) continue;
      if (/^\.env\./.test(relativePath) && relativePath !== '.env.example') continue;
      files.push(relativePath);
    }
  }
  return files;
}

function candidateFiles() {
  return runGitLsFiles() || walk(root);
}

function isTextCandidate(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return !binaryExtensions.has(extension);
}

function scanFile(relativePath) {
  if (!isTextCandidate(relativePath)) return [];

  const absolutePath = path.join(root, relativePath);
  let text = '';
  try {
    text = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return [];
  }

  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const check of checks) {
      if (check.pattern.test(line)) {
        findings.push({
          file: relativePath,
          line: index + 1,
          label: check.label,
        });
      }
    }
  }
  return findings;
}

const files = candidateFiles();
const findings = files.flatMap(scanFile);

if (findings.length) {
  console.error('Public safety audit failed. Review these files before publishing:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.label})`);
  }
  process.exit(1);
}

console.log(`Public safety audit passed. Checked ${files.length} file(s).`);
