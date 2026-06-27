const fs = require('fs');
const path = require('path');
const i18nPath = path.join(__dirname, 'renderer', 'i18n.js');
let content = fs.readFileSync(i18nPath, 'utf8');

const newKeys = {
  'pt-BR': `    terminal: 'Terminal',
    milestones: 'Milestones',
    git: 'Git',
    map: 'Mapa',
    askAi: 'Perguntar à IA',
    mapRendering: 'Renderização do Mapa',
    itemDetails: 'Detalhes do Item',
    incrementalEditingActive: 'Edição incremental ativa',
    initialCreationMode: 'Modo criação inicial',
    noSession: 'Sem sessão',
    gitNotActive: 'Git ainda não ativo',
    localRepository: 'Repositório local',
    localHistoryDesc: 'Crie o histórico local antes de stage, commit e deploy.',
    filesChangedSingle: 'arquivo alterado',
    filesChangedPlural: 'arquivos alterados',
    untrackedTitle: 'Novos Arquivos (Untracked)',
    untrackedDesc: 'arquivos não rastreados.',
    modifiedTitle: 'Arquivos Modificados',
    stagedTitle: 'Arquivos no Stage',
`,
  'en-US': `    terminal: 'Terminal',
    milestones: 'Milestones',
    git: 'Git',
    map: 'Map',
    askAi: 'Ask AI',
    mapRendering: 'Map Rendering',
    itemDetails: 'Item Details',
    incrementalEditingActive: 'Incremental editing active',
    initialCreationMode: 'Initial creation mode',
    noSession: 'No session',
    gitNotActive: 'Git not active yet',
    localRepository: 'Local Repository',
    localHistoryDesc: 'Create local history before staging, committing and deploying.',
    filesChangedSingle: 'changed file',
    filesChangedPlural: 'changed files',
    untrackedTitle: 'New Files (Untracked)',
    untrackedDesc: 'untracked files.',
    modifiedTitle: 'Modified Files',
    stagedTitle: 'Staged Files',
`,
  'es-ES': `    terminal: 'Terminal',
    milestones: 'Milestones',
    git: 'Git',
    map: 'Mapa',
    askAi: 'Preguntar a la IA',
    mapRendering: 'Renderizado del Mapa',
    itemDetails: 'Detalles del Ítem',
    incrementalEditingActive: 'Edición incremental activa',
    initialCreationMode: 'Modo de creación inicial',
    noSession: 'Sin sesión',
    gitNotActive: 'Git aún no activo',
    localRepository: 'Repositorio Local',
    localHistoryDesc: 'Cree el historial local antes de stage, commit y deploy.',
    filesChangedSingle: 'archivo modificado',
    filesChangedPlural: 'archivos modificados',
    untrackedTitle: 'Nuevos Archivos (Untracked)',
    untrackedDesc: 'archivos no rastreados.',
    modifiedTitle: 'Archivos Modificados',
    stagedTitle: 'Archivos en Stage',
`
};

for (const lang of ['pt-BR', 'en-US', 'es-ES']) {
  const marker = `'${lang}': {\n`;
  content = content.replace(marker, marker + newKeys[lang]);
}

fs.writeFileSync(i18nPath, content);
console.log('Updated i18n.js successfully.');
