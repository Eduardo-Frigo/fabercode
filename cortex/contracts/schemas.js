function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const {
  validateBlueprintRouteModePair,
} = require('../orchestration/product_route_mode_contract_service');

function asErrorList(errors) {
  return Array.isArray(errors) ? errors.filter(Boolean) : [];
}

function validateStringField(errors, value, name, { required = true } = {}) {
  const valid = typeof value === 'string' && (!required || Boolean(value.trim()));
  if (!valid) errors.push(`${name} must be ${required ? 'a non-empty' : 'a'} string`);
}

function validateArrayField(errors, value, name, { required = false } = {}) {
  if (value === undefined && !required) return;
  if (!Array.isArray(value)) errors.push(`${name} must be an array`);
}

function validateRouteDecision(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['route_decision must be an object'] };
  }

  const decision = String(value.decision || '').trim().toLowerCase();
  if (!['chat', 'clarify', 'execute'].includes(decision)) {
    errors.push('decision must be one of chat, clarify, execute');
  }

  if (typeof value.response !== 'string' || !value.response.trim()) {
    errors.push('response must be a non-empty string');
  }

  if (decision === 'execute' && (typeof value.executionMessage !== 'string' || !value.executionMessage.trim())) {
    errors.push('executionMessage is required when decision=execute');
  }

  if (value.confidence !== undefined) {
    const confidence = Number(value.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push('confidence must be a number between 0 and 1');
    }
  }

  return {
    ok: errors.length === 0,
    errors: asErrorList(errors),
    value: errors.length
      ? null
      : {
          decision,
          response: value.response.trim(),
          executionMessage: typeof value.executionMessage === 'string' ? value.executionMessage.trim() : '',
          confidence: value.confidence === undefined ? 0.8 : Number(value.confidence),
        },
  };
}

function normalizeOperation(rawOperation) {
  if (!isPlainObject(rawOperation)) return null;
  const op = String(rawOperation.op || rawOperation.action || rawOperation.type || '').trim().toLowerCase();
  const opName =
    op === 'mkdir' || op === 'create_directory' || op === 'directory'
      ? 'mkdir'
      : op === 'write_file' || op === 'create_file' || op === 'file'
        ? 'write_file'
        : op === 'append_file'
          ? 'append_file'
          : '';
  const path = String(rawOperation.path || rawOperation.file || rawOperation.target || '').trim();
  if (!opName || !path) return null;
  if (opName === 'mkdir') return { op: opName, path };
  return {
    op: opName,
    path,
    content: typeof rawOperation.content === 'string' ? rawOperation.content : '',
  };
}

function validateOperationBatchPlan(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['execution_plan must be an object'] };
  }

  if (typeof value.summary !== 'string' || !value.summary.trim()) {
    errors.push('summary must be a non-empty string');
  }

  if (!Array.isArray(value.operations) || value.operations.length === 0) {
    errors.push('operations must be a non-empty array');
  }

  const operations = Array.isArray(value.operations)
    ? value.operations.map(normalizeOperation).filter(Boolean)
    : [];

  if (Array.isArray(value.operations) && operations.length !== value.operations.length) {
    errors.push('all operations must have a supported op and path');
  }

  const writes = operations.filter((operation) => operation.op === 'write_file' || operation.op === 'append_file');
  for (const operation of writes) {
    if (typeof operation.content !== 'string') {
      errors.push(`content must be a string for ${operation.path}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors: asErrorList(errors),
    value: errors.length
      ? null
      : {
          summary: value.summary.trim(),
          operations,
        },
  };
}

function validateWorkingBriefContract(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['working_brief must be an object'], value: null };
  }

  if (value.schemaVersion !== 'working-brief-v1') {
    errors.push('working_brief.schemaVersion must be working-brief-v1');
  }

  if (!isPlainObject(value.source)) errors.push('working_brief.source must be an object');
  if (!isPlainObject(value.intent)) errors.push('working_brief.intent must be an object');
  if (!isPlainObject(value.product)) errors.push('working_brief.product must be an object');

  if (isPlainObject(value.intent)) {
    validateStringField(errors, value.intent.action, 'working_brief.intent.action');
    validateStringField(errors, value.intent.contentMode, 'working_brief.intent.contentMode', { required: false });
    validateStringField(errors, value.intent.autonomy, 'working_brief.intent.autonomy', { required: false });
  }

  if (isPlainObject(value.product)) {
    validateStringField(errors, value.product.domain, 'working_brief.product.domain', { required: false });
    validateStringField(errors, value.product.stack, 'working_brief.product.stack', { required: false });
  }

  if (!isPlainObject(value.style)) errors.push('working_brief.style must be an object');
  validateArrayField(errors, value.mediaIntent, 'working_brief.mediaIntent', { required: true });
  validateArrayField(errors, value.iconIntent, 'working_brief.iconIntent', { required: true });
  validateStringField(errors, value.executionPrompt, 'working_brief.executionPrompt', { required: false });

  return {
    ok: errors.length === 0,
    errors: asErrorList(errors),
    value: errors.length ? null : value,
  };
}

function validateBuildModeRouteContract(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['build_mode_route must be an object'], value: null };
  }

  if (value.schemaVersion !== 'build-mode-route-v1') {
    errors.push('build_mode_route.schemaVersion must be build-mode-route-v1');
  }
  validateStringField(errors, value.mode, 'build_mode_route.mode');
  validateStringField(errors, value.capability, 'build_mode_route.capability');
  validateStringField(errors, value.executionIntent, 'build_mode_route.executionIntent');

  if (value.confidence !== undefined) {
    const confidence = Number(value.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push('build_mode_route.confidence must be a number between 0 and 1');
    }
  }

  if (value.workingBrief !== undefined) {
    const briefValidation = validateWorkingBriefContract(value.workingBrief);
    if (!briefValidation.ok) {
      errors.push(...briefValidation.errors.map((error) => `build_mode_route.${error}`));
    }
  }

  return {
    ok: errors.length === 0,
    errors: asErrorList(errors),
    value: errors.length ? null : value,
  };
}

function validateProductRouteContract(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['product_route_decision must be an object'], value: null };
  }

  if (value.schemaVersion !== 'product-route-v1') {
    errors.push('product_route_decision.schemaVersion must be product-route-v1');
  }

  const routeDecisionValidation = validateRouteDecision(value);
  if (!routeDecisionValidation.ok) errors.push(...routeDecisionValidation.errors);

  if (!isPlainObject(value.productRoute)) {
    errors.push('productRoute must be an object');
  } else {
    validateStringField(errors, value.productRoute.capability, 'productRoute.capability');
    validateStringField(errors, value.productRoute.mode, 'productRoute.mode');
    validateStringField(errors, value.productRoute.executionIntent, 'productRoute.executionIntent', { required: false });
    validateStringField(errors, value.productRoute.projectState, 'productRoute.projectState', { required: false });
  }

  if (value.workingBrief !== undefined && value.workingBrief !== null) {
    const briefValidation = validateWorkingBriefContract(value.workingBrief);
    if (!briefValidation.ok) errors.push(...briefValidation.errors.map((error) => `product_route.${error}`));
  }

  if (value.buildModeRoute !== undefined && value.buildModeRoute !== null) {
    const buildModeValidation = validateBuildModeRouteContract(value.buildModeRoute);
    if (!buildModeValidation.ok) {
      errors.push(
        ...buildModeValidation.errors
          .filter((error) => !error.includes('working_brief'))
          .map((error) => `product_route.${error}`)
      );
    }
  }

  if (isPlainObject(value.productRoute)) {
    const routeModeValidation = validateBlueprintRouteModePair({
      productRouteMode: value.productRoute.mode,
      buildMode: value.buildModeRoute && value.buildModeRoute.mode ? value.buildModeRoute.mode : '',
      capability: value.productRoute.capability,
      decision: value.decision,
    });
    if (!routeModeValidation.ok) {
      errors.push(...routeModeValidation.errors.map((error) => `product_route.${error}`));
    }
  }

  return {
    ok: errors.length === 0,
    errors: asErrorList(errors),
    value: errors.length ? null : value,
  };
}

module.exports = {
  validateAutomataOperationBatchPlan: validateOperationBatchPlan,
  validateBuildModeRouteContract,
  validateCortexBuildModeRouteContract: validateBuildModeRouteContract,
  validateCortexProductRouteContract: validateProductRouteContract,
  validateOperationBatchPlan,
  validatePersonaWorkingBriefContract: validateWorkingBriefContract,
  validateProductRouteContract,
  validateRouteDecision,
  validateWorkingBriefContract,
};
