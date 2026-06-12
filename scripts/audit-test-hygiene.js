const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

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

const focusedTestPattern = /\b(?:context|describe|it|test)\.only\s*\(/;
const skippedTestPattern = /\b(?:context|describe|it|test)\.skip\s*\(/;
const staleMarkerPattern = new RegExp(`\\b(?:${['TO', 'DO'].join('')}|${['FIX', 'ME'].join('')})\\b`);

const checks = [
  {
    label: 'focused test modifier',
    pattern: focusedTestPattern,
  },
  {
    label: 'disabled test modifier',
    pattern: skippedTestPattern,
  },
  {
    label: 'stale work marker',
    pattern: staleMarkerPattern,
  },
];

const allowedFindings = [];

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
    return [];
  }
}

function isTextCandidate(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return !binaryExtensions.has(extension);
}

function isAllowedFinding(finding) {
  return allowedFindings.some((entry) => {
    if (entry.file && entry.file !== finding.file) return false;
    if (entry.line && entry.line !== finding.line) return false;
    if (entry.label && entry.label !== finding.label) return false;
    return true;
  });
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
  return findings.filter((finding) => !isAllowedFinding(finding));
}

const files = runGitLsFiles();
const findings = files.flatMap(scanFile);

if (findings.length) {
  console.error('Test hygiene audit failed. Review these files before publishing:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.label})`);
  }
  process.exit(1);
}

console.log(`Test hygiene audit passed. Checked ${files.length} file(s).`);
