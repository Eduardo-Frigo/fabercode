const { createPersonaOrchestrator } = require('./persona_orchestrator');

// Compatibility wrapper for older imports. New orchestration code should import persona_orchestrator directly.
function createAssistantFlow(dependencies = {}) {
  return createPersonaOrchestrator(dependencies);
}

module.exports = {
  createAssistantFlow,
};
