# Faber Code - Proximo Smoke, Riscos e Criterios 2026-05-25

Este documento descreve o proximo smoke recomendado depois do commit `30e163c Fortalece contratos e workspace apos smoke tests`.

Atualizacao: depois desse commit foram adicionadas mudancas locais para smoke tests 34 a 42, MCP-compatible capability layer e correcao pos-briefing Lumen Lab. O smoke automatizado atual passou com 27 cenarios, mas o proximo smoke manual real continua necessario antes de commit.

## Objetivo do proximo smoke

Validar se as correcoes feitas apos os testes 32 e 33 aparecem no uso real, nao apenas nos testes automatizados.

O foco nao e provar que o produto esta pronto; e descobrir com clareza se os principais erros continuam:

- blueprint generico;
- memoria antiga contaminando briefing novo;
- paginas rasas em site completo;
- validacao visual dizendo que passou sem captura real;
- painel central sumindo quando laterais recolhem.

## Ordem recomendada

1. Rodar app local.
2. Fazer login se necessario.
3. Criar projeto novo para Aurea IP.
4. Rodar briefing completo do teste 32.
5. Validar resultado gerado, mensagens e preview.
6. Criar projeto novo para Linea Bosco.
7. Rodar briefing completo do teste 33.
8. Validar rotas, paginas, identidade visual e preview.
9. Testar recolhimento de paineis no workspace.
10. Registrar screenshots e terminal.

## Comandos antes do smoke

```bash
cd "<repo-root>"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24.15.0
git status --short
node tests/smoke-scenarios.test.js
npm run test:renderer-workspace-layout
npm run test:renderer-panel-layout
npm run test:project-preview-runtime
npm run test:project-visual-validation-runtime
npm run dev
```

Para bateria completa:

```bash
npm run test:architecture
```

## Criterios para Aurea IP

O resultado deve conter:

- marca `Aurea IP & Patentes`;
- dominio de propriedade intelectual;
- hero coerente com protecao estrategica de ideias/patentes;
- busca de anterioridade;
- redacao de pedido de patente;
- deposito e acompanhamento;
- registro de marcas;
- protecao internacional;
- especialista ou lideranca tecnica;
- processo;
- CTA de consultoria.

O resultado nao pode conter:

- `Escritorio Faber Advocacia`;
- `Faber Projeto`;
- `Atendimento placeholder premium`;
- `Studio Habitat`;
- `Helena Duarte Arquitetura`;
- copy generica de "presenca digital clara";
- formulario raso quando o briefing pediu atendimento consultivo.

## Criterios para Linea Bosco

O resultado deve conter:

- marca `Linea Bosco Revestimentos`;
- dominio de pisos/revestimentos de madeira;
- home com pisos de madeira, paineis ripados, decks e acabamentos;
- paginas ou rotas reais para produtos, pisos, paineis, decks, projetos, inspiracoes e contato;
- linguagem visual premium/minimalista;
- texturas/madeiras como carvalho, nogueira, cumaru, freijo, tauari ou ipe;
- formulario de orcamento qualificado;
- CTA de orcamento ou especialista.

O resultado nao pode conter:

- `Studio Habitat`;
- `Helena Duarte Arquitetura`;
- dominio de arquitetura generica;
- projetos/cases de arquitetura que nao sejam revestimentos/madeira;
- paginas internas quase vazias.

## Criterios de preview e captura

Aceitavel:

- captura real concluida;
- ou falha clara dizendo que nao houve captura real;
- ou uso honesto de preview manual quando `127.0.0.1:3000` estiver disponivel.

Nao aceitavel:

- relatorio dizendo que visual passou sem captura;
- `100%` visual quando o erro real foi timeout de preview;
- auto-reparo de arquivos quando a falha foi somente captura indisponivel.

## Criterios de workspace

Testar manualmente:

- recolher painel esquerdo;
- restaurar painel esquerdo;
- recolher painel direito;
- restaurar painel direito;
- recolher ambos;
- alterar largura de painel;
- abrir terminal;
- abrir configuracoes;
- mudar modo de workspace.

Resultado esperado:

- centro permanece visivel;
- logo/fallback central nao some;
- painel direito nao recolhe sozinho por erro de largura;
- terminal nao parece caixa solta sem estado;
- configuracoes refletem preferencias salvas.

## Riscos tecnicos atuais

| Risco | Leitura |
| --- | --- |
| Provider retorna plano inutilizavel | Ainda possivel. Precisa de falha controlada e regeneracao guiada. |
| Memoria antiga contamina briefing | Reduzido por context frame, escopo, expiracao e smoke dedicado. Prova manual continua util para UX. |
| Blueprint generico retorna | Reduzido em dominios cobertos, ainda possivel em dominio novo. |
| Contrato de rota initial/adaptive/faber | Reduzido por contrato dedicado: build mode e product route mode agora sao validados em pares. |
| Captura visual falha por timeout | Ainda possivel. Deve ser relatado como falha de captura, nao sucesso visual. |
| Site completo superficial | Ainda risco central para produto. Rotas existem, mas profundidade precisa validacao manual. |
| UX de paineis em edge cases | Melhorou, mas precisa teste manual em janelas estreitas e paineis recolhidos. |
| Memoria/RAG/MemPalace | Melhorou com escopo, TTL, citacoes e motivo de recuperacao; falta persistencia historica ampla por job/projeto. |

## Criterio de sucesso do proximo smoke

O smoke sera considerado satisfatorio se:

- Aurea IP nao cair em advocacia generica;
- Linea Bosco nao cair em Studio Habitat/arquitetura;
- Lumen Lab ou outro laboratorio fotografico cair em `photo-lab`, nao em atendimento digital generico;
- rotas reais existirem para site completo;
- preview/captura falhar honestamente quando falhar;
- `browser_preview.capture` gerar evidencia real ou explicar o bloqueio;
- menu hamburger funcionar em mobile nos projetos gerados;
- assets/Pexels aparecerem como imagem/video contextual, nao placeholder visual generico;
- paineis recolhidos nao apagarem o centro;
- relatorio final diferenciar tecnica, estatica, captura real e aderencia.

## Criterio de falha produtiva

Mesmo se o smoke falhar, ele sera util se registrar:

- briefing usado;
- mensagens exibidas;
- arquivos alterados;
- rotas geradas;
- motivo de bloqueio;
- se houve captura real;
- screenshots do resultado;
- terminal com erros relevantes.

O proximo ajuste deve partir dessa evidencia, nao de suposicao.
