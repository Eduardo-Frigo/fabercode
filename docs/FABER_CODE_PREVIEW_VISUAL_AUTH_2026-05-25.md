# Faber Code - Preview, Validacao Visual e Auth 2026-05-25

Este documento registra as atualizacoes feitas no fluxo de preview, captura visual real, validacao por viewport e login externo.

## Problema diagnosticado

O Faber Code ja conseguia gerar projetos e rodar validacoes tecnicas, mas a validacao visual ainda podia ficar confusa em tres pontos:

- o sistema podia declarar aderencia estatica alta sem captura real;
- o preview manual aberto pelo usuario em `127.0.0.1:3000` nao era reaproveitado de forma clara;
- o callback de login externo deixava uma tela pouco polida no navegador.

## Objetivo da correcao

Separar validacao tecnica, analise estatica e validacao visual real. A conclusao visual so pode ser liberada quando houver captura do preview.

## Modulos envolvidos

- `main/services/project_preview_service.js`
- `main/services/project_preview_runtime_service.js`
- `main/services/project_visual_validation_runtime_service.js`
- `main/services/faber_capability_adapter_service.js`
- `cortex/capabilities/capability_gateway.js`
- `cortex/orchestration/visual_validation_service.js`
- `cortex/orchestration/visual_product_coverage_service.js`
- `main/services/platform_auth_callback_page_service.js`
- `main/services/platform_backend_service.js`
- `renderer/account_gate.js`
- `renderer/styles/account-gate.css`

## Preview manual

O runtime passou a reconhecer melhor o caso em que o usuario ja rodou o projeto manualmente e o Next esta pronto em `127.0.0.1:3000`.

Resultado esperado:

- se o servidor manual estiver acessivel, o sistema pode usa-lo como fonte de preview;
- se nao houver captura, a validacao visual permanece pendente;
- mensagens de status devem diferenciar `preview pronto`, `captura pendente` e `captura falhou`.

## Estados de validacao visual

A validacao foi separada em estados mais honestos:

- tecnica aprovada;
- analise estatica aprovada;
- captura real pendente;
- captura real falhou;
- captura real aprovada;
- cobertura visual insuficiente.

Isso evita mensagens como "visual passou" quando a plataforma ainda nao conseguiu enxergar o preview.

## Cobertura visual por viewport

A validacao visual passou a olhar para evidencias por viewport, incluindo:

- desktop;
- tablet;
- mobile.

As secoes de produto esperadas incluem:

- hero acima da dobra;
- CTA principal;
- loja/produtos quando o briefing pedir;
- blog/insights quando o briefing pedir;
- galeria/portfolio/projetos quando o briefing pedir;
- depoimentos;
- contato/formulario;
- footer.

## Falha de captura

Quando a captura falha por timeout, bloqueio de preview ou indisponibilidade do servidor, o sistema deve preservar o checkpoint e nao acionar auto-reparo de arquivos sem evidencia de que o problema esta no codigo gerado.

## Capability de browser preview

A validacao visual pode usar a capability `browser_preview.capture` para iniciar/reaproveitar preview e capturar evidencias por viewport. Essa camada e MCP-compatible: ela nao decide se o produto esta correto, apenas devolve preview, capturas, artefatos, erros e logs em formato padronizado para o gate visual.

Quando a action for `capture`, o adapter local pode permitir instalacao/preparacao de dependencias do projeto antes de declarar bloqueio manual de preview. Isso reduz falso negativo em projeto recem-gerado, mas nao muda o contrato principal: se a captura real continuar indisponivel, a validacao visual deve falhar ou ficar pendente sem acionar auto-reparo de arquivos.

## Auth callback

Foi criado um servico dedicado para a pagina de callback de login:

- `main/services/platform_auth_callback_page_service.js`

A tela de retorno do navegador foi simplificada e recebeu apresentacao da marca FaberCode, com mensagem clara:

- `Login feito com sucesso!`
- `Pode fechar essa pagina.`

O botao verde foi removido para reduzir ruido visual e deixar claro que a aba externa nao e a experiencia principal do app.

## Criterios de aceite

- Preview manual ativo pode ser reaproveitado.
- Validacao visual sem captura real deve ficar pendente ou falhar honestamente.
- Falha de captura nao deve disparar auto-reparo de arquivos.
- Callback de login deve ser simples, com marca FaberCode e instrucao clara.
- O app deve continuar como origem principal da sessao depois do login.
