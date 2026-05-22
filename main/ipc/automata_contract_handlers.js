function registerAutomataContractHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    ledgerService,
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Automata contract IPC dependency missing: ${name}`);
  }

  requireDependency('appendAuditEvent', appendAuditEvent);
  requireDependency('ledgerService', ledgerService);
  requireDependency('registerIpcHandler', registerIpcHandler);

  function normalizeProject(payload = {}) {
    const projectInfo = payload && payload.projectInfo ? payload.projectInfo : null;
    if (projectInfo && typeof normalizeAuthorizedProjectInfo === 'function') {
      const project = normalizeAuthorizedProjectInfo(projectInfo);
      if (!project.ok) return project;
      return {
        ok: true,
        project: {
          projectId: project.projectInfo.id || payload.projectId || '',
          rootPath: project.projectInfo.rootPath || '',
        },
      };
    }

    return {
      ok: true,
      project: {
        projectId: payload.projectId || '',
        rootPath: payload.rootPath || '',
      },
    };
  }

  function audit(type, payload = {}) {
    try {
      appendAuditEvent(type, payload);
    } catch {
      // O ledger nao deve falhar por uma falha secundaria de auditoria.
    }
  }

  registerIpcHandler('automata:contracts:list', (_, payload = {}) => {
    const project = normalizeProject(payload);
    if (!project.ok) return project;
    return ledgerService.listEntries({
      projectId: payload.projectId || project.project.projectId || '',
      rootPath: payload.rootPath || project.project.rootPath || '',
      status: payload.status,
      includeRejected: payload.includeRejected,
    });
  });

  registerIpcHandler('automata:contracts:summary', (_, payload = {}) => {
    const project = normalizeProject(payload);
    if (!project.ok) return project;
    return ledgerService.summarizeLedger({
      projectId: payload.projectId || project.project.projectId || '',
      rootPath: payload.rootPath || project.project.rootPath || '',
    });
  });

  registerIpcHandler('automata:contracts:suggest', (_, payload = {}) => {
    const project = normalizeProject(payload);
    if (!project.ok) return project;
    const result = ledgerService.suggestContract(payload.contract || payload, {
      project: project.project,
      provider: payload.provider || 'assistant',
    });
    if (result.ok) {
      audit('automata_contract.suggested', {
        ledgerId: result.entry.id,
        contractId: result.entry.contractId,
        projectId: result.entry.projectId,
      });
    }
    return result;
  });

  registerIpcHandler('automata:contracts:stage', (_, payload = {}) => {
    const result = ledgerService.stageContract(payload.id, {
      note: payload.note || '',
    });
    if (result.ok) {
      audit('automata_contract.staged', {
        ledgerId: result.entry.id,
        contractId: result.entry.contractId,
        projectId: result.entry.projectId,
      });
    }
    return result;
  });

  registerIpcHandler('automata:contracts:trial', (_, payload = {}) => {
    const result = payload.running
      ? ledgerService.markTrialRunning(payload.id, { note: payload.note || '' })
      : ledgerService.markTrialResult(payload.id, {
          passed: Boolean(payload.passed),
          note: payload.note || '',
        });
    if (result.ok) {
      audit('automata_contract.trial_updated', {
        ledgerId: result.entry.id,
        contractId: result.entry.contractId,
        status: result.entry.status,
      });
    }
    return result;
  });

  registerIpcHandler('automata:contracts:promote', (_, payload = {}) => {
    const result = ledgerService.promoteContract(payload.id, {
      note: payload.note || '',
    });
    if (result.ok) {
      audit('automata_contract.promoted', {
        ledgerId: result.entry.id,
        contractId: result.entry.contractId,
        projectId: result.entry.projectId,
      });
    }
    return result;
  });

  registerIpcHandler('automata:contracts:reject', (_, payload = {}) => {
    const result = ledgerService.rejectContract(payload.id, {
      note: payload.note || '',
    });
    if (result.ok) {
      audit('automata_contract.rejected', {
        ledgerId: result.entry.id,
        contractId: result.entry.contractId,
        projectId: result.entry.projectId,
      });
    }
    return result;
  });
}

module.exports = {
  registerAutomataContractHandlers,
};
