'use strict';

const INFRASTRUCTURE_FAILURE_PATTERN = /(?:\bkill\s+eperm\b|\boperation not permitted\b|\bprocess terminated by sig|\benotfound\b|\beai_again\b|\betimedout\b|\blive_corpus_[a-z0-9_]+\b|\bnpm_egress_blocked\b)/i;

function clipText(value = '', maximum = 5_000) {
  const text = String(value || '').replace(/\0/g, '');
  return text.length > maximum ? `${text.slice(0, maximum - 3)}...` : text;
}

function redactWorkspacePaths(value, rootPaths = []) {
  let output = String(value || '');
  const paths = Array.from(rootPaths || [], (entry) => String(entry || '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const rootPath of paths) output = output.split(rootPath).join('<workspace>');
  return output;
}

function createApplicationCreationLiveCorpusRepairService(options = {}) {
  const maxAttempts = Math.max(0, Math.min(4, Number(options.maxAttempts) || 2));

  function shouldAttemptRepair(input = {}) {
    const attempt = Math.max(0, Number(input.attempt) || 0);
    if (attempt >= maxAttempts) return false;
    if (!input.generation || typeof input.generation !== 'object') return false;
    const generationModifiedFiles = Array.isArray(input.generation.modifiedFiles)
      ? input.generation.modifiedFiles.filter((entry) => (
          typeof entry === 'string' && entry.trim()
        ))
      : [];
    const repairableGeneration = input.generation.ok === true
      || generationModifiedFiles.length > 0;
    if (!repairableGeneration
      || INFRASTRUCTURE_FAILURE_PATTERN.test(
        String(input.generation.message || '')
      )) return false;
    if (!input.installResult || input.installResult.ok !== true) return false;
    if (!input.verification || input.verification.ready === true) return false;

    const commandFailures = (Array.isArray(input.executionLog) ? input.executionLog : [])
      .filter((entry) => entry && entry.ok === false);
    const requiredFailures = (Array.isArray(input.verification.results)
      ? input.verification.results
      : [])
      .filter((entry) => entry && entry.required === true
        && (entry.status === 'failed' || entry.status === 'blocked'));
    if (!commandFailures.length && !requiredFailures.length) return false;
    return !commandFailures.some((entry) => (
      INFRASTRUCTURE_FAILURE_PATTERN.test(String(entry.message || ''))
    ));
  }

  function buildRepairPrompt(input = {}) {
    const scenario = input.scenario && typeof input.scenario === 'object' ? input.scenario : {};
    const rootPaths = Array.isArray(input.rootPaths) ? input.rootPaths : [];
    const verification = input.verification && typeof input.verification === 'object'
      ? input.verification
      : {};
    const resultFailures = (Array.isArray(verification.results) ? verification.results : [])
      .filter((entry) => entry && (entry.status === 'failed' || entry.status === 'blocked'))
      .slice(0, 12)
      .map((entry) => {
        const detail = entry.detail ? ` — ${entry.detail}` : '';
        return `- ${entry.id || 'verification'} [${entry.status}]${detail}`;
      });
    const commandFailures = (Array.isArray(input.executionLog) ? input.executionLog : [])
      .filter((entry) => entry && entry.ok === false)
      .slice(0, 8)
      .map((entry) => {
        const command = [entry.bin, ...(Array.isArray(entry.args) ? entry.args : [])]
          .filter(Boolean)
          .join(' ');
        return `- ${command || 'comando'}: ${entry.message || 'falhou sem saída'}`;
      });
    const evidence = redactWorkspacePaths(
      [...resultFailures, ...commandFailures].join('\n'),
      rootPaths
    );
    const targetedGuidance = [];
    if (/module is not defined in es module scope|next\.config\.js/i.test(evidence)) {
      targetedGuidance.push(
        '- Configuração ESM: use next.config.mjs ou export default; não use module.exports em .js quando package.json declara type=module.'
      );
    }
    if (/trying to use typescript|required packages are missing|typescript|tsconfig/i.test(evidence)) {
      targetedGuidance.push(
        '- TypeScript: alinhe tsconfig e arquivos .ts/.tsx às devDependencies necessárias, ou remova TypeScript integralmente; se editar package.json, a instalação segura será refeita pelo runner.'
      );
    }
    if (/acceptance_auth/i.test(evidence)) {
      targetedGuidance.push(
        '- Auth: implemente boundary dedicado com comportamento verificável, por exemplo authenticate e verifyPassword ou sessão equivalente.'
      );
    }
    if (/acceptance_upload/i.test(evidence)) {
      targetedGuidance.push(
        '- Upload: comprove seleção/FormData, handler request.formData ou multipart e persistência real via storage.upload ou writeFile.'
      );
    }
    if (/node_test|node --test|npm --ignore-scripts test/i.test(evidence)) {
      targetedGuidance.push(
        '- Testes: leia o teste e o módulo alvo, use node:test de forma determinística e evite efeitos colaterais como iniciar servidor durante import.'
      );
    }
    const originalRequirement = redactWorkspacePaths(
      clipText(scenario.prompt || '', 1_800),
      rootPaths
    );
    return clipText([
      `Repare a aplicação existente do cenário ${scenario.id || 'corpus-vivo'} no workspace ativo.`,
      'Não instale pacotes, não execute comandos, não use rede e não altere arquivos fora do projeto.',
      'Leia os arquivos relacionados às evidências, faça a menor correção funcional e preserve todos os requisitos originais.',
      `Requisito original: ${originalRequirement}`,
      'Evidências reais da validação offline:',
      evidence || '- validação obrigatória não ficou pronta',
      ...(targetedGuidance.length
        ? ['Orientações derivadas das evidências:', ...targetedGuidance]
        : []),
      'Depois das edições, use inspect_project_validation, corrija qualquer falha estática restante e finalize com finish_task.',
    ].join('\n'), 5_000);
  }

  return Object.freeze({
    buildRepairPrompt,
    maxAttempts,
    shouldAttemptRepair,
  });
}

module.exports = {
  INFRASTRUCTURE_FAILURE_PATTERN,
  createApplicationCreationLiveCorpusRepairService,
  redactWorkspacePaths,
};
