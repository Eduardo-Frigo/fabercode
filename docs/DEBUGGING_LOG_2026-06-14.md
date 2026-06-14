# Log de Correções e Tentativas - Agentic Loop & UI (Faber Code)

Este documento registra as falhas encontradas durante a utilização da arquitetura Faber Code, nossas análises e as tentativas de correção realizadas. O objetivo é estabelecer um histórico para guiar futuras melhorias, tendo em vista que a estabilidade do fluxo agentic local ainda não atingiu o resultado satisfatório desejado.

## Histórico de Problemas e Soluções Tentadas

### 1. Ferramentas Agentic "Cegas" (Falha ao ler arquivos e árvore)
**Problema:** O LLM iniciava a execução para analisar um erro, mas retornava a mensagem: *"Tarefa encerrada: Não consegui investigar o problema porque as ferramentas de inspeção do projeto (project_tree, read_file, run_command) não retornam conteúdo"*.
**Causa:** Na formatação da resposta das capabilities (`buildCapabilityResult` em `cortex/capabilities/capability_result.js`), o objeto interno com o resultado (`data`) não estava sendo exposto. O modelo recebia os status de sucesso, mas sem os dados da árvore ou conteúdo do arquivo lido.
**Ação:** Foi adicionada a propriedade `data: evidence.data` explicitamente na formatação final da capability, permitindo que a saída chegasse ao prompt do modelo.

### 2. O Erro "Sem Alterar Arquivos" (Ações sem impacto material)
**Problema:** Execuções eram barradas prematuramente pelo orquestrador lançando erro de falha por "A execução terminou sem criar ou alterar arquivos", mesmo após o modelo diagnosticar o problema de forma inconclusiva ou após a resolução de pequenos ajustes.
**Causa:** A função `actionRequiresMaterialChange` e as diretivas no loop avaliavam certas saídas prematuramente, esperando mudanças onde o contexto não as requeria imediatamente. 
**Ação:** Ajustes realizados na verificação material do loop para permitir conclusões não modificadoras sem engatilhar falha sistêmica. Porém, isso introduziu ou expôs os problemas seguintes nas tentativas de reconectar.

### 3. Melhoria no UX: Preview de Imagens (Drag and Drop)
**Problema:** O usuário não conseguia pré-visualizar as imagens que arrastava (Drag and Drop) para o composer do chat; a imagem ficava apenas com um nome de arquivo (pill de texto), diferentemente do padrão de ferramentas consolidadas (ex: Antigravity). E, ainda por cima, não era garantido se a imagem estava sendo processada.
**Causa:** A renderização (`chat_composer.js`) listava apenas o nome. 
**Ação:** Foi implementado suporte a preview no arquivo `renderer/chat_composer.js` (`addImageFiles` e `renderAttachments`), além de injeção de estilo no `renderer/styles/core.css` (`.attachment-thumb`), tornando a visibilidade análoga ao comportamento esperado.

### 4. Loop Infinito do Agent (Atingindo Limite de 40 Passos)
**Problema:** O LLM do Faber Code iniciava o loop de planejamento e ficava rodando até que o sistema cortasse à força (`execute_failed`) informando *"O loop agentic atingiu o limite de 40 passos antes de concluir"*.
**Causa (Análise do arquivo jobs.json):** 
Duas falhas aconteciam em cadeia:
1. **Corrupção no JSON de Resposta (`clipText`):** A ferramenta `read_file` lia os dados do arquivo, mas a função `summarizeToolResultForModel` (em `agentic_tool_loop_service.js`) usava uma função agressiva de encurtamento de texto (`clipText`) após fazer o `JSON.stringify`. Isso removia todas as quebras de linha (`\n`) substituindo-as por espaço e fatiando o JSON ao meio, resultando em um JSON inválido para a IA, ou num bloco de código sem qualquer formatação de recuo.
2. **Terminal Inexistente:** Após receber esse JSON corrompido, o LLM entrava em parafuso e tentava testar o projeto executando a ferramenta `run_command`. Como a tool esperava ou podia receber um parâmetro `sessionId`, o LLM inventava um id falso (ex: `"1"`). Isso causava falha silenciosa "Terminal não encontrado", o que fazia o agente repetir a requisição indefinidamente.

**Ações Tomadas (Mais Recentes):**
1. **Truncamento Seguro:** Modificamos `summarizeToolResultForModel` para não usar `clipText` no JSON final, mas sim truncar seguramente as strings gigantes no objeto (`summary.data.content`) ANTES do stringify (`JSON.stringify(..., null, 2)`). Com isso, formatação (indentações de código e chaves) e validade do JSON são preservadas para o LLM.
2. **Fallback no `run_command`:** Inserimos uma verificação no adapter de terminal (`faber_capability_adapter_service.js`). Se o `sessionId` enviado for inválido, o serviço automaticamente descarta a id falsa e cria uma sessão válida transparente para o agente, devolvendo a saída sem erros críticos irreais.

## Status Atual
Apesar das correções mecânicas nas ferramentas (o Agente agora consegue ler o código sem corrupção JSON e não quebra tentando abrir o terminal indevidamente), a fluidez conversacional do assistente ainda é afetada caso ele decida "tomar atitude" sem dialogar antes (`autoExecute: true` em algumas diretivas). O comportamento requer novos testes massivos de ponta-a-ponta para garantir que as reações não culminem em mais anomalias arquiteturais de "Agentic Loop".

*Documento gerado sob análise interativa entre Usuário e Assistente Antigravity para acompanhamento.*
