function createProjectPreviewDiagnosticService(dependencies = {}) {
  const {
    buildProjectPreviewPlan,
  } = dependencies;

  if (typeof buildProjectPreviewPlan !== 'function') {
    throw new Error('Project preview diagnostic dependency missing: buildProjectPreviewPlan');
  }

  function clipText(value = '', max = 900) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const limit = Math.max(120, Number(max) || 900);
    return text.length > limit ? text.slice(0, limit).trim() : text;
  }

  function summarizeLatestDiagnostics(latestDiagnostics = null) {
    if (!latestDiagnostics || typeof latestDiagnostics !== 'object') return '';
    const candidates = [
      latestDiagnostics.message,
      latestDiagnostics.error,
      latestDiagnostics.reason,
      latestDiagnostics.summary,
      latestDiagnostics.stderr,
      latestDiagnostics.stdout,
    ].filter(Boolean);
    return clipText(candidates.join(' '), 900);
  }

  function findDependencyStep(plan = {}) {
    const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
    return steps.find((step) => step && step.id === 'preview_dependencies') || null;
  }

  function summarizeBlockedSteps(plan = {}) {
    const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
    return steps
      .filter((step) => step && step.status === 'blocked')
      .map((step) => String(step.label || step.id || '').trim())
      .filter(Boolean);
  }

  function buildPreviewDiagnosticResponse({ projectInfo, latestDiagnostics = null, options = {} } = {}) {
    const plan = buildProjectPreviewPlan(projectInfo || {}, options || {});
    const warnings = Array.isArray(plan && plan.warnings)
      ? plan.warnings.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const blockedSteps = summarizeBlockedSteps(plan);
    const dependencyStep = findDependencyStep(plan);
    const latest = summarizeLatestDiagnostics(latestDiagnostics);

    if (!plan || plan.ok === false) {
      return {
        ok: true,
        ready: false,
        reason: 'preview_diagnostic_blocked',
        response: [
          'Diagnóstico do preview: não consegui montar um plano de visualização para este projeto.',
          plan && plan.message ? `Motivo: ${clipText(plan.message, 600)}` : '',
          latest ? `Último erro registrado: ${latest}` : '',
        ].filter(Boolean).join('\n'),
        plan,
      };
    }

    if (!plan.ready) {
      const lines = [
        'Diagnóstico do preview: a visualização ainda está bloqueada antes de abrir o navegador.',
        plan.message ? `Estado: ${clipText(plan.message, 600)}` : '',
      ];
      if (dependencyStep && dependencyStep.commandText) {
        lines.push(`Correção necessária: rodar \`${dependencyStep.commandText}\` na pasta do projeto.`);
      }
      if (dependencyStep && dependencyStep.detail) {
        lines.push(`Detalhe: ${clipText(dependencyStep.detail, 700)}`);
      }
      if (blockedSteps.length) {
        lines.push(`Etapas bloqueadas: ${blockedSteps.join(', ')}.`);
      }
      if (warnings.length) {
        lines.push(`Avisos: ${warnings.map((warning) => clipText(warning, 300)).join(' | ')}`);
      }
      if (latest) {
        lines.push(`Último erro registrado: ${latest}`);
      }
      return {
        ok: true,
        ready: false,
        reason: 'preview_diagnostic_blocked',
        response: lines.filter(Boolean).join('\n'),
        plan,
      };
    }

    const lines = [
      'Diagnóstico do preview: a estrutura local está pronta para visualização.',
      plan.commandText ? `Comando de preview: \`${plan.commandText}\`.` : '',
      plan.url ? `URL esperada: ${plan.url}` : '',
      latest ? `Último erro registrado anteriormente: ${latest}` : '',
      'Se a tela ainda falhar, o próximo passo é iniciar o preview e capturar a saída do servidor para mostrar o erro exato.',
    ];

    return {
      ok: true,
      ready: true,
      reason: 'preview_diagnostic_ready',
      response: lines.filter(Boolean).join('\n'),
      plan,
    };
  }

  return {
    buildPreviewDiagnosticResponse,
  };
}

module.exports = {
  createProjectPreviewDiagnosticService,
};
