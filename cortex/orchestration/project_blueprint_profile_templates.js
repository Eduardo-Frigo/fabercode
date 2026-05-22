const {
  isCssOperationPath,
  normalizeCssImportOrder,
} = require('./css_operation_safety');
const { escapeHtml } = require('./project_blueprint_template_utils');
const { normalizeBlueprintText } = require('./project_blueprint_utils');

function slugifyBlueprintValue(value = '') {
  return normalizeBlueprintText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'faber-projeto';
}

function renderBlueprintTemplate(value = '', { brand = 'Faber Projeto' } = {}) {
  const text = String(value || '');
  return text
    .replace(/\{\{brand\}\}/g, brand)
    .replace(/\{\{brandHtml\}\}/g, escapeHtml(brand))
    .replace(/\{\{brandJson\}\}/g, JSON.stringify(brand))
    .replace(/\{\{brandSlug\}\}/g, slugifyBlueprintValue(brand));
}

function isSafeBlueprintPath(value = '') {
  const normalized = String(value || '').replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
  return !normalized.split('/').some((segment) => segment === '..');
}

function buildProfileBlueprintOperations({ profile, brand }) {
  const blueprint = profile && profile.blueprint ? profile.blueprint : {};
  const operations = Array.isArray(blueprint.operations) ? blueprint.operations : [];
  const allowedOps = new Set(['write_file', 'append_file', 'mkdir']);

  return operations
    .map((operation) => {
      if (!operation || typeof operation !== 'object') return null;
      const op = String(operation.op || '').trim();
      const targetPath = String(operation.path || '').replace(/\\/g, '/').trim();
      if (!allowedOps.has(op) || !isSafeBlueprintPath(targetPath)) return null;

      const normalized = {
        op,
        path: targetPath,
      };
      if (op !== 'mkdir') {
        const content = renderBlueprintTemplate(operation.content || '', { brand });
        normalized.content = isCssOperationPath(targetPath) ? normalizeCssImportOrder(content) : content;
      }
      return normalized;
    })
    .filter(Boolean);
}


module.exports = {
  buildProfileBlueprintOperations,
  isSafeBlueprintPath,
  renderBlueprintTemplate,
  slugifyBlueprintValue,
};
