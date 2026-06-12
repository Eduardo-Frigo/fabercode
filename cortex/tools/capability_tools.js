function createCapabilityTools(capabilityGateway) {
  if (
    !capabilityGateway ||
    typeof capabilityGateway.executeCapability !== 'function' ||
    typeof capabilityGateway.listCapabilities !== 'function'
  ) {
    throw new Error('Capability gateway ausente para registrar tools.');
  }

  return [
    {
      name: 'faber.capabilities.list',
      description: 'Lista capacidades operacionais MCP-compatible registradas no Faber Code.',
      permission: 'read',
      inputSchema: { type: 'object' },
      handler: () => ({ ok: true, capabilities: capabilityGateway.listCapabilities() }),
    },
    {
      name: 'faber.capabilities.execute',
      description: 'Executa uma capacidade operacional padronizada com evidencia e sessao de projeto.',
      permission: 'write',
      inputSchema: {
        type: 'object',
        required: ['capability', 'action', 'projectSession'],
      },
      handler: (input) => capabilityGateway.executeCapability(input),
    },
  ];
}

module.exports = {
  createCapabilityTools,
};
