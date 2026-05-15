function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asErrorList(errors) {
  return Array.isArray(errors) ? errors.filter(Boolean) : [];
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

module.exports = {
  validateOperationBatchPlan,
  validateRouteDecision,
};
