function createAutomataTools(executor) {
  if (!executor || typeof executor.execute !== 'function') {
    throw new Error('Automata executor ausente para registrar tools.');
  }

  return [
    {
      name: 'automata.execute_action',
      description: 'Executa uma ação validada do Automata, incluindo contratos executionCommand.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['type'],
      },
      handler: (input) => executor.execute(input),
    },
    {
      name: 'automata.apply_file_patch',
      description: 'Aplica patch textual em um arquivo dentro da raiz autorizada do projeto.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['type', 'rootPath', 'targetFile', 'previousContentHash', 'nextContent'],
      },
      handler: (input) => executor.executePatchAction(input),
    },
    {
      name: 'automata.execute_operation_batch',
      description: 'Executa lote pré-validado de criação/escrita/anexo de arquivos.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['rootPath', 'operations'],
      },
      handler: (input) => executor.executeOperationBatchAction(input),
    },
    {
      name: 'automata.search_text_in_files',
      description: 'Busca texto em arquivos do projeto sem modificar conteúdo.',
      permission: 'read',
      inputSchema: {
        type: 'object',
        required: ['rootPath', 'targetText'],
      },
      handler: (input) => executor.executeSearchTextAction(input),
    },
  ];
}

module.exports = {
  createAutomataTools,
};
