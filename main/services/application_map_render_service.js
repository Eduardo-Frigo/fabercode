const defaultFs = require('fs');
const defaultPath = require('path');

function createApplicationMapRenderService(dependencies = {}) {
  const fs = dependencies.fs || defaultFs;
  const path = dependencies.path || defaultPath;
  const mapService = dependencies.mapService;

  function renderMap(rootPath) {
    if (!mapService) {
      return { ok: false, message: 'mapService dependency missing' };
    }

    try {
      const map = mapService.getMap(rootPath);
      const docsDir = path.join(rootPath, 'docs', 'application-map');
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
      }

      // Group nodes by parentId
      const rootNodes = map.nodes.filter(n => !n.parentId);
      const groups = rootNodes.filter(n => n.type === 'group' || n.type === 'folder');
      const orphanNodes = rootNodes.filter(n => n.type !== 'group' && n.type !== 'folder');

      // 1. Generate README.md
      let readme = '# Mapa da Aplicação\n\nEste diretório contém a documentação técnica gerada automaticamente pelo Faber Code a partir do Mapa da Aplicação.\n\n';
      readme += '## Grupos Principais\n\n';
      
      groups.forEach(g => {
        const fileBasename = g.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.md';
        readme += `- [${g.title}](./${fileBasename})\n`;
      });
      if (orphanNodes.length) {
        readme += '\n## Itens Avulsos\n\n';
        orphanNodes.forEach(n => {
          readme += `- **${n.title}** (${n.type}): ${n.description || ''}\n`;
        });
      }
      fs.writeFileSync(path.join(docsDir, 'README.md'), readme, 'utf8');

      // 2. Generate separate md for each group
      groups.forEach(g => {
        const fileBasename = g.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.md';
        const children = map.nodes.filter(n => n.parentId === g.id);

        let content = `# ${g.title}\n\n`;
        if (g.description) content += `${g.description}\n\n`;
        if (g.content) content += `${g.content}\n\n`;

        children.forEach(child => {
          content += `## ${child.title}\n\n`;
          content += `**Tipo:** \`${child.type}\`\n\n`;
          if (child.description) content += `${child.description}\n\n`;

          if (child.type === 'image' || child.type === 'asset') {
            const relPath = child.assetId || child.content;
            if (relPath && relPath.startsWith('Map assets')) {
              // Image link relative to docs/application-map/ (which is 2 levels deep)
              content += `![${child.title}](../../${relPath.replace(/\\/g, '/')})\n\n`;
            }
          } else if (child.content) {
            content += `${child.content}\n\n`;
          }

          // Relations
          const nodeEdges = map.edges.filter(e => e.sourceNodeId === child.id || e.targetNodeId === child.id);
          if (nodeEdges.length) {
            content += `### Relações de ${child.title}\n\n`;
            nodeEdges.forEach(e => {
              const otherId = e.sourceNodeId === child.id ? e.targetNodeId : e.sourceNodeId;
              const otherNode = map.nodes.find(n => n.id === otherId);
              if (otherNode) {
                const prefix = e.sourceNodeId === child.id ? '-> Conecta com' : '<- Conectado por';
                content += `- ${prefix} **${otherNode.title}** (Relação: \`${e.type || 'link'}\` ${e.label ? `- ${e.label}` : ''})\n`;
              }
            });
            content += '\n';
          }
        });

        fs.writeFileSync(path.join(docsDir, fileBasename), content, 'utf8');
      });

      // 3. Generate open-questions.md
      const questions = map.nodes.filter(n => n.type === 'text' && (n.title.toLowerCase().includes('?') || (n.description && n.description.includes('?'))));
      let questionsContent = '# Perguntas Abertas\n\nLista de dúvidas e pontos a serem decididos na arquitetura do projeto:\n\n';
      if (questions.length) {
        questions.forEach(q => {
          questionsContent += `- **${q.title}**: ${q.description || q.content || ''}\n`;
        });
      } else {
        questionsContent += 'Nenhuma pergunta aberta registrada no mapa.\n';
      }
      fs.writeFileSync(path.join(docsDir, 'open-questions.md'), questionsContent, 'utf8');

      // 4. Generate decisions.md
      const decisions = map.nodes.filter(n => n.type === 'decision' || (n.tags && n.tags.includes('decisão')));
      let decisionsContent = '# Decisões de Projeto\n\nRegistro de definições de arquitetura e produto consolidadas:\n\n';
      if (decisions.length) {
        decisions.forEach(d => {
          decisionsContent += `- **${d.title}**: ${d.description || d.content || ''}\n`;
        });
      } else {
        decisionsContent += 'Nenhuma decisão registrada formalmente no mapa.\n';
      }
      fs.writeFileSync(path.join(docsDir, 'decisions.md'), decisionsContent, 'utf8');

      // 5. Save copy of raw json
      fs.writeFileSync(path.join(docsDir, 'application-map.json'), JSON.stringify(map, null, 2), 'utf8');

      return { ok: true, docsPath: docsDir };
    } catch (e) {
      console.error('Failed to render application map', e);
      return { ok: false, message: e.message || String(e) };
    }
  }

  return {
    renderMap,
  };
}

module.exports = {
  createApplicationMapRenderService,
};
