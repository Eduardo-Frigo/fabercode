# Faber Code - QA e correcoes seguras de roteamento e contratos

Data: 2026-06-27

## Contexto

Esta rodada partiu de um teste completo de diagnostico sem alterar a ferramenta em funcionamento. O full tool loop principal ja estava passando, entao as correcoes foram aplicadas de forma localizada para alinhar testes, contratos de runtime e heuristicas de roteamento sem alterar o fluxo funcional validado.

## Correcoes aplicadas

### 1. IPC de Git atualizado nos testes

O handler de projetos passou a exigir historico de commits e rollback para commit especifico. O teste de IPC foi atualizado para injetar:

- `getProjectGitCommits`
- `rollbackProjectGitToCommit`

Tambem foi atualizado o total esperado de handlers de projeto de `32` para `34`.

### 2. Verificacao de toolchain com instalacao antes do build

O contrato de verificacao agora executa `npm install` quando as dependencias locais estao ausentes ou desalinhadas antes de rodar `npm run build`. Os testes de toolchain foram atualizados para refletir esse comportamento seguro.

### 3. Ordem real do painel direito

O teste de chrome/layout esperava um botao `btn-automata-contracts` que nao existe mais no HTML atual. A expectativa foi alinhada ao painel em uso:

- Git
- Terminal
- Executar

### 4. Loop agentic conclui apos alteracao real

O loop agentic podia repetir chamadas de ferramenta ate estourar limite quando o modelo fazia alteracao real e depois respondia com texto final sem chamar `finish_task`. Agora, se ja houve arquivo modificado e existe mensagem final, o loop conclui com sucesso.

### 5. Roteamento de criacao preservado em projeto vazio

Pedidos de criacao que mencionam validacao funcional, como "validar campos vazios" ou "estados de erro visiveis", nao sao mais tratados como diagnostico quando o projeto esta vazio e ha escopo suficiente para criar.

### 6. Integracoes/capabilities temporarias reconhecidas como superficie de criacao

Briefings como "crie uma integracao simulada com servico externo" agora sao reconhecidos como criacao valida quando incluem contrato temporario, capability, input/output, timeout, retry e fallback.

### 7. SaaS grande com primeira versao funcional

Briefings complexos de SaaS com modulos explicitos e pedido de "primeira versao funcional" agora sao considerados suficientes para execucao inicial guiada, sem cair em esclarecimento indevido.

### 8. Audit publico desbloqueado

Foram removidos caminhos absolutos locais de uma documentacao antiga do plano de mapa/milestones e substituidos por referencias relativas/descritivas.

## Validacoes executadas

- `npm run test:ipc`
- `npm run test:product-toolchain-contract`
- `npm run test:window-chrome-css`
- `node tests/agentic-tool-loop-service.test.js`
- `npm run test:product-intake`
- `npm run test:product-orchestrator`
- `npm run test:working-brief`
- `npm run test:briefing-spec`
- `node tests/application-map-service.test.js`
- `node tests/milestone-service.test.js`
- `node tests/renderer-map-tool-switching.test.js`
- `npm run smoke:scenarios`
- `npm run smoke:full-tool-loop`
- `npm run smoke:briefing-loop-matrix`
- `npm run audit:release`

## Resultado

Os testes e smokes principais passaram apos as correcoes. O smoke de matriz validou 24 casos em 9 grupos, com 207 artefatos gerados e gates esperados. O full tool loop principal continuou passando, confirmando que as correcoes nao quebraram a ferramenta ja funcional.
