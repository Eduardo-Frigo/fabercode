function createHostRequirementsService(dependencies = {}) {
  const {
    platform = process.platform,
    runCommand,
  } = dependencies;

  if (typeof runCommand !== 'function') {
    throw new Error('Host requirements service missing dependency: runCommand');
  }

  function getInstallUrl(toolId) {
    if (toolId === 'node') return 'https://nodejs.org/en/download';
    if (toolId === 'git') {
      if (platform === 'darwin') return 'https://git-scm.com/download/mac';
      if (platform === 'win32') return 'https://git-scm.com/download/win';
      return 'https://git-scm.com/download/linux';
    }
    return '';
  }

  function getGuidance(toolId) {
    if (toolId === 'node') {
      return {
        pt: 'Instale o Node.js LTS para permitir terminal, preview local e automações do projeto.',
        en: 'Install the Node.js LTS release so local terminal, preview, and project automations can run.',
        es: 'Instala la versión LTS de Node.js para habilitar terminal local, preview y automatizaciones del proyecto.',
      };
    }
    return {
      pt: 'Instale o Git para habilitar histórico local, commits e integração com repositórios.',
      en: 'Install Git to enable local history, commits, and repository integration.',
      es: 'Instala Git para habilitar historial local, commits e integración con repositorios.',
    };
  }

  async function inspectCommand(toolId, command, args = []) {
    try {
      const result = await runCommand(command, args, { timeoutMs: 5000 });
      const output = String(result.stdout || result.stderr || '').trim();
      return {
        id: toolId,
        installed: Boolean(result && result.ok),
        version: output.split(/\r?\n/).find(Boolean) || '',
        command,
        installUrl: getInstallUrl(toolId),
        guidance: getGuidance(toolId),
      };
    } catch (error) {
      return {
        id: toolId,
        installed: false,
        version: '',
        command,
        installUrl: getInstallUrl(toolId),
        guidance: getGuidance(toolId),
        error: error && error.message ? error.message : 'command_failed',
      };
    }
  }

  async function getHostRequirements() {
    const requirements = await Promise.all([
      inspectCommand('node', 'node', ['--version']),
      inspectCommand('git', 'git', ['--version']),
    ]);
    return {
      ok: true,
      ready: requirements.every((item) => item.installed),
      requirements,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    getHostRequirements,
  };
}

module.exports = {
  createHostRequirementsService,
};
