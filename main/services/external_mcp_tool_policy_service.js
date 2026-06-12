const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const DEFAULT_ALLOWED_PERMISSIONS = ['read', 'write'];
const DEFAULT_BLOCKED_RISK_LEVELS = ['critical'];
const DEFAULT_MAX_RISK_LEVEL = 'high';
const DEFAULT_ALLOWED_NETWORK_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const DEFAULT_BLOCKED_DIRECTORIES = ['.git', 'node_modules'];

const fs = require('fs');
const path = require('path');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeId(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeList(value = []) {
  if (Array.isArray(value)) return value.map((entry) => normalizeId(entry)).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((entry) => normalizeId(entry))
    .filter(Boolean);
}

function normalizeTextList(value = []) {
  if (Array.isArray(value)) return value.map((entry) => normalizeText(entry)).filter(Boolean);
  return String(value || '')
    .split(/\r?\n|,/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizeHost(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

function normalizeHostList(value = []) {
  return normalizeTextList(value).map(normalizeHost).filter(Boolean);
}

function normalizeRiskLevel(value = '') {
  const normalized = normalizeId(value);
  return RISK_LEVELS.includes(normalized) ? normalized : '';
}

function normalizePermission(value = '') {
  const normalized = normalizeId(value);
  if (normalized === 'write' || normalized === 'admin' || normalized === 'network' || normalized === 'read') {
    return normalized;
  }
  return 'read';
}

function getRiskRank(value = '') {
  const normalized = normalizeRiskLevel(value);
  const index = RISK_LEVELS.indexOf(normalized);
  return index >= 0 ? index : RISK_LEVELS.indexOf(DEFAULT_MAX_RISK_LEVEL);
}

function normalizeRiskPolicy(policy = {}) {
  const input = policy && typeof policy === 'object' ? policy : {};
  const maxRiskLevel = normalizeRiskLevel(input.maxRiskLevel || input.maxRisk || input.risk) || DEFAULT_MAX_RISK_LEVEL;
  const blockedRiskLevels = normalizeList(input.blockedRiskLevels || input.blockedRisks || DEFAULT_BLOCKED_RISK_LEVELS)
    .map(normalizeRiskLevel)
    .filter(Boolean);
  const allowedPermissions = normalizeList(input.allowedPermissions || input.permissions || DEFAULT_ALLOWED_PERMISSIONS)
    .map(normalizePermission)
    .filter(Boolean);
  return {
    maxRiskLevel,
    blockedRiskLevels: blockedRiskLevels.length ? Array.from(new Set(blockedRiskLevels)) : DEFAULT_BLOCKED_RISK_LEVELS,
    allowedPermissions: allowedPermissions.length ? Array.from(new Set(allowedPermissions)) : DEFAULT_ALLOWED_PERMISSIONS,
    requireExplicitAllowForHighRisk: input.requireExplicitAllowForHighRisk === true,
  };
}

function normalizeScopePolicy(policy = {}) {
  const input = policy && typeof policy === 'object' ? policy : {};
  const hasAllowedNetworkHosts = Object.prototype.hasOwnProperty.call(input, 'allowedNetworkHosts') ||
    Object.prototype.hasOwnProperty.call(input, 'allowedHosts') ||
    Object.prototype.hasOwnProperty.call(input, 'networkHosts');
  return {
    enforceProjectRoot: input.enforceProjectRoot !== false,
    allowedDirectories: normalizeTextList(input.allowedDirectories || input.allowedDirs || input.directories || []),
    blockedDirectories: normalizeTextList(input.blockedDirectories || input.blockedDirs || DEFAULT_BLOCKED_DIRECTORIES),
    allowExternalNetwork: input.allowExternalNetwork === true,
    allowedNetworkHosts: hasAllowedNetworkHosts
      ? normalizeHostList(input.allowedNetworkHosts || input.allowedHosts || input.networkHosts || [])
      : DEFAULT_ALLOWED_NETWORK_HOSTS,
    blockedNetworkHosts: normalizeHostList(input.blockedNetworkHosts || input.blockedHosts || []),
  };
}

function inferRiskLevel(tool = {}, permission = 'read') {
  const annotations = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  const explicitRisk = normalizeRiskLevel(
    tool.riskLevel ||
    tool.risk ||
    annotations.riskLevel ||
    annotations.risk ||
    annotations.dangerLevel
  );
  if (explicitRisk) return explicitRisk;

  if (annotations.destructiveHint === true) return 'critical';
  if (annotations.openWorldHint === true) {
    return permission === 'read' ? 'medium' : 'high';
  }

  const haystack = [
    tool.name,
    tool.description,
    permission,
  ].map((item) => normalizeText(item).toLowerCase()).join(' ');

  if (/\b(delete|remove|rm|drop|reset|destroy|purge|erase|chmod|chown|shell|exec|command|subprocess|terminal)\b/.test(haystack) ||
    /\bformat\s+(disk|drive|volume|filesystem|fs)\b/.test(haystack)) {
    return 'critical';
  }
  if (/(write|edit|create|move|rename|upload|publish|deploy|post|send|apply|mutate|update)/.test(haystack)) {
    return 'high';
  }
  if (/(capture|fetch|http|network|download|scan|index|search|query)/.test(haystack)) {
    return 'medium';
  }
  return 'low';
}

function classifyExternalMcpTool(tool = {}, serverPermission = 'read') {
  const annotations = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  const permission = normalizePermission(tool.permission || annotations.permission || serverPermission || 'read');
  const riskLevel = inferRiskLevel(tool, permission);
  return {
    permission,
    riskLevel,
    riskRank: getRiskRank(riskLevel),
  };
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function collectArgumentStrings(value, { keyPath = [], depth = 0, entries = [] } = {}) {
  if (depth > 4 || value === null || value === undefined) return entries;
  if (typeof value === 'string') {
    entries.push({ key: keyPath[keyPath.length - 1] || '', value });
    return entries;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectArgumentStrings(item, {
      keyPath: [...keyPath, String(index)],
      depth: depth + 1,
      entries,
    }));
    return entries;
  }
  if (isObject(value)) {
    Object.keys(value).forEach((key) => collectArgumentStrings(value[key], {
      keyPath: [...keyPath, key],
      depth: depth + 1,
      entries,
    }));
  }
  return entries;
}

function parseUrl(value = '') {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseNetworkReference(entry = {}) {
  const value = normalizeText(entry.value);
  if (!value) return null;
  if (looksLikeUrl(value)) {
    const parsed = parseUrl(value);
    return parsed ? { ...entry, host: parsed.hostname, value } : null;
  }
  if (isNetworkArgumentKey(entry.key) && !/[\\/]/.test(value)) {
    const parsed = parseUrl(`http://${value}`);
    return parsed && parsed.hostname ? { ...entry, host: parsed.hostname, value } : null;
  }
  return null;
}

function looksLikeUrl(value = '') {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizeText(value));
}

function isDirectoryArgumentKey(key = '') {
  return /(path|dir|directory|root|file|folder|artifact|output|input|source|target|destination)$/i.test(key);
}

function isNetworkArgumentKey(key = '') {
  return /(url|uri|href|endpoint|webhook|host)$/i.test(key);
}

function resolvePolicyPath(value = '', rootPath = '') {
  const text = normalizeText(value);
  if (!text || looksLikeUrl(text)) return '';
  if (path.isAbsolute(text)) return path.resolve(text);
  if (!rootPath) return '';
  return path.resolve(rootPath, text);
}

function isSubPath(candidate = '', parent = '') {
  const childPath = path.resolve(candidate);
  const parentPath = path.resolve(parent);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

function realpathIfExists(candidate = '') {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return '';
  }
}

function findNearestExistingParent(candidate = '', rootPath = '') {
  let current = path.resolve(path.dirname(candidate));
  const root = path.resolve(rootPath);
  while (current && isSubPath(current, root)) {
    if (fs.existsSync(current)) return current;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return fs.existsSync(root) ? root : '';
}

function resolvePhysicalPolicyPath(candidate = '', rootPath = '') {
  const resolved = path.resolve(candidate);
  const existing = fs.existsSync(resolved) ? resolved : findNearestExistingParent(resolved, rootPath);
  return existing ? realpathIfExists(existing) : '';
}

function normalizePolicyDirectories(directories = [], rootPath = '') {
  return normalizeTextList(directories)
    .map((entry) => resolvePolicyPath(entry, rootPath))
    .filter(Boolean);
}

function hostMatchesPolicy(host = '', hosts = []) {
  const normalizedHost = normalizeHost(host);
  return hosts.some((entry) => {
    const normalizedEntry = normalizeHost(entry);
    return normalizedEntry === '*' ||
      normalizedEntry === normalizedHost ||
      normalizedHost.endsWith(`.${normalizedEntry}`);
  });
}

function evaluateToolScopePolicy({ server = {}, arguments: toolArguments = {}, projectSession = {} } = {}) {
  const scopePolicy = normalizeScopePolicy(server.scopePolicy);
  const rootPath = normalizeText(projectSession.rootPath);
  const strings = collectArgumentStrings(toolArguments);
  const pathEntries = strings.filter((entry) => isDirectoryArgumentKey(entry.key) && !looksLikeUrl(entry.value));
  const urlEntries = strings
    .map(parseNetworkReference)
    .filter(Boolean);
  const violations = [];

  if (scopePolicy.enforceProjectRoot && pathEntries.length && !rootPath) {
    violations.push({
      reason: 'external_mcp_directory_scope_requires_project_root',
      value: pathEntries[0].value,
    });
  }

  if (rootPath && pathEntries.length) {
    const physicalRootPath = realpathIfExists(rootPath) || path.resolve(rootPath);
    const allowedDirectories = normalizePolicyDirectories(
      scopePolicy.allowedDirectories.length ? scopePolicy.allowedDirectories : [rootPath],
      rootPath
    );
    const blockedDirectories = normalizePolicyDirectories(scopePolicy.blockedDirectories, rootPath);
    for (const entry of pathEntries) {
      const resolvedPath = resolvePolicyPath(entry.value, rootPath);
      if (!resolvedPath) continue;
      if (scopePolicy.enforceProjectRoot && !isSubPath(resolvedPath, rootPath)) {
        violations.push({
          key: entry.key,
          reason: 'external_mcp_directory_outside_project_root',
          value: entry.value,
          resolvedPath,
        });
        continue;
      }
      const physicalPath = resolvePhysicalPolicyPath(resolvedPath, rootPath);
      if (scopePolicy.enforceProjectRoot && physicalPath && !isSubPath(physicalPath, physicalRootPath)) {
        violations.push({
          key: entry.key,
          reason: 'external_mcp_directory_physical_outside_project_root',
          value: entry.value,
          resolvedPath,
          physicalPath,
        });
        continue;
      }
      if (allowedDirectories.length && !allowedDirectories.some((allowedPath) => isSubPath(resolvedPath, allowedPath))) {
        violations.push({
          key: entry.key,
          reason: 'external_mcp_directory_not_allowed',
          value: entry.value,
          resolvedPath,
        });
        continue;
      }
      if (blockedDirectories.some((blockedPath) => isSubPath(resolvedPath, blockedPath))) {
        violations.push({
          key: entry.key,
          reason: 'external_mcp_directory_blocked',
          value: entry.value,
          resolvedPath,
        });
      }
    }
  }

  for (const entry of urlEntries) {
    const host = normalizeHost(entry.host);
    if (hostMatchesPolicy(host, scopePolicy.blockedNetworkHosts)) {
      violations.push({
        key: entry.key,
        reason: 'external_mcp_network_host_blocked',
        value: entry.value,
        host,
      });
      continue;
    }
    const allowedByHost = hostMatchesPolicy(host, scopePolicy.allowedNetworkHosts);
    if (!scopePolicy.allowExternalNetwork && !allowedByHost) {
      violations.push({
        key: entry.key,
        reason: 'external_mcp_network_host_not_allowed',
        value: entry.value,
        host,
      });
    }
  }

  return {
    allowed: violations.length === 0,
    blockedReason: violations.length ? violations[0].reason : '',
    scopePolicy,
    violations,
  };
}

function evaluateToolPolicy({ server = {}, tool = {}, allowedByList = false, blockedByList = false } = {}) {
  const riskPolicy = normalizeRiskPolicy(server.riskPolicy);
  const classification = classifyExternalMcpTool(tool, server.permission);
  const explicitAllowed = Boolean(allowedByList);
  const permissionAllowed = riskPolicy.allowedPermissions.includes(classification.permission);
  const riskBlocked = riskPolicy.blockedRiskLevels.includes(classification.riskLevel);
  const riskTooHigh = classification.riskRank > getRiskRank(riskPolicy.maxRiskLevel);
  const highRiskNeedsAllow = riskPolicy.requireExplicitAllowForHighRisk &&
    classification.riskRank >= getRiskRank('high') &&
    !explicitAllowed;
  return {
    ...classification,
    riskPolicy,
    permissionAllowed,
    riskBlocked,
    riskTooHigh,
    highRiskNeedsAllow,
    blockedReason: blockedByList
      ? 'tool_blocked_by_policy'
      : !permissionAllowed
        ? 'tool_permission_blocked_by_policy'
        : riskBlocked
          ? 'tool_risk_blocked_by_policy'
          : riskTooHigh
            ? 'tool_risk_exceeds_policy'
            : highRiskNeedsAllow
              ? 'tool_high_risk_requires_allowlist'
              : '',
    allowedByRiskPolicy: Boolean(!blockedByList && permissionAllowed && !riskBlocked && !riskTooHigh && !highRiskNeedsAllow),
  };
}

module.exports = {
  DEFAULT_ALLOWED_PERMISSIONS,
  DEFAULT_BLOCKED_RISK_LEVELS,
  DEFAULT_MAX_RISK_LEVEL,
  DEFAULT_ALLOWED_NETWORK_HOSTS,
  DEFAULT_BLOCKED_DIRECTORIES,
  RISK_LEVELS,
  classifyExternalMcpTool,
  evaluateToolScopePolicy,
  evaluateToolPolicy,
  normalizeRiskPolicy,
  normalizeScopePolicy,
};
