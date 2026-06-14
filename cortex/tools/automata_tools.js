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
      description: 'Executa lote pré-validado de criação, escrita, anexo e deleção de arquivos ou pastas. Operações suportadas: mkdir, write_file, append_file, delete_file, delete_dir.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['rootPath', 'operations'],
        properties: {
          rootPath: { type: 'string' },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['op', 'path'],
              properties: {
                op: { type: 'string', enum: ['mkdir', 'write_file', 'append_file', 'delete_file', 'delete_dir'] },
                path: { type: 'string', description: 'Caminho relativo do arquivo ou pasta.' },
                content: { type: 'string', description: 'Conteúdo textual (obrigatório apenas para write_file e append_file).' }
              }
            }
          }
        }
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
    {
      name: 'automata.edit_file_fuzzy',
      description: 'Edita um arquivo existente substituindo um bloco de texto por outro usando fallback cascade (ignora diferenças de espaços e indentações).',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['rootPath', 'targetFile', 'targetContent', 'replacementContent'],
        properties: {
          rootPath: { type: 'string' },
          targetFile: { type: 'string' },
          targetContent: { type: 'string', description: 'O conteúdo exato (ou aproximado) que deseja substituir.' },
          replacementContent: { type: 'string', description: 'O novo conteúdo que substituirá o alvo.' }
        }
      },
      handler: (input) => executor.executeEditFileFuzzyAction(input),
    },
  ];
}

module.exports = {
  createAutomataTools,
};
