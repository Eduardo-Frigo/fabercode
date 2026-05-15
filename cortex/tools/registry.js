function createToolRegistry() {
  const toolsByName = new Map();

  function register(tool) {
    if (!tool || typeof tool !== 'object') {
      throw new Error('Tool inválida.');
    }
    const name = String(tool.name || '').trim();
    if (!name) {
      throw new Error('Tool sem nome.');
    }
    if (toolsByName.has(name)) {
      throw new Error(`Tool duplicada: ${name}`);
    }
    if (typeof tool.handler !== 'function') {
      throw new Error(`Tool sem handler: ${name}`);
    }

    toolsByName.set(name, {
      description: String(tool.description || '').trim(),
      inputSchema: tool.inputSchema || { type: 'object' },
      name,
      permission: String(tool.permission || 'read').trim(),
      handler: tool.handler,
    });
  }

  function list() {
    return Array.from(toolsByName.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      permission: tool.permission,
      inputSchema: tool.inputSchema,
    }));
  }

  function get(name) {
    return toolsByName.get(String(name || '').trim()) || null;
  }

  function execute(name, input) {
    const tool = get(name);
    if (!tool) {
      return { ok: false, message: `Tool não registrada: ${name}` };
    }
    return tool.handler(input);
  }

  return {
    execute,
    get,
    list,
    register,
  };
}

module.exports = {
  createToolRegistry,
};
