# Conclusão do tutorial e da Landing Page de Boas-Vindas

**Data:** 2 de agosto de 2026
**Escopo:** onboarding, tutorial guiado, Mapa da Aplicação, desenvolvimento local e landing page gerada

## Visão geral

Este ciclo conclui a experiência de tutorial do Faber Code de ponta a ponta. O fluxo apresenta a interface, cria ou seleciona o contexto de projeto, ensina o Mapa da Aplicação, simula conversas sem consumo de créditos, organiza milestones, acompanha desenvolvimento e Git local e termina com a execução da landing page personalizada.

## Avanços do tutorial

### Etapas 1 a 7

- Apresentação dos painéis e ferramentas principais.
- Demonstração de projetos arquivados, lixeira, Cortex e configuração de APIs.
- Exemplo de API descartável, sem persistir chave falsa.
- Preparação do projeto e entrada no Mapa da Aplicação.
- Destaques, cursor guiado, spotlight e posicionamento do card adaptados ao contexto aberto.

### Etapas 8 a 10

- Construção do briefing, Design System, referências, grupos, regras e documentação de arquitetura.
- Nome do usuário armazenado e usado para personalizar a landing page.
- Assistente do mapa e análise executados localmente, sem chamada de provedor.
- Histórico do mapa, correção de lacunas, geração e persistência de milestones.

### Etapas 11 a 13

- Conversa de desenvolvimento persistida como conversa comum do projeto.
- Escrita progressiva dos arquivos reais da landing page.
- Fluxo Git local com revisão de mudanças e commits orientados.
- Execução local, abertura do preview e feedback de sucesso ou nova tentativa.

## Regra de navegação final

- **Próximo** é um controle de navegação, não um prêmio por concluir checklist.
- O botão nunca é desabilitado por uma demonstração incompleta.
- Ao avançar manualmente, contextos modais são fechados para evitar bloqueios invisíveis.
- Checklists e autoavanço continuam existindo como feedback para o percurso guiado.
- A solicitação do nome é a única ação obrigatória. Sem nome salvo, o tutorial abre a pergunta e valida o valor antes de continuar.
- O nome pode ser confirmado pelo botão dedicado, pela tecla Enter ou pelo próprio botão **Próximo**.

## Avanços da landing page

- Atmosfera escura, grid técnico, verde controlado e movimento orbital preservados.
- Conexão entre sessões refeita como uma única curva responsiva.
- Linha inferior pós-clique removida da estrutura e dos estilos.
- Cards orbitais transportados para o viewport por portal, com inversão e clamp de posição.
- Órbitas, planetas e núcleo redistribuídos para melhor leitura.
- Feedback de conexões e conclusão da interação reforçado.
- Scroll horizontal contido e responsividade validada.
- Copy e geração consistentes em português, inglês e espanhol.

## Arquitetura da geração

O diretório `Boas-Vindas/` funciona como protótipo visual. A fonte usada para novos usuários é `renderer/tutorial_welcome_project.js`, apoiada por `renderer/tutorial_copy.js`. O teste `tests/renderer-tutorial-welcome-project.test.js` protege a presença das interações, a ausência da linha residual, o uso de portal nos cards e a geometria da curva.

## Matriz de validação

| Área | Validação |
| --- | --- |
| Tutorial | sintaxe do renderer e contrato de módulos |
| Gerador | testes de copy e projeto de boas-vindas |
| LP | lint e build de produção |
| Desktop | `1600x900`, sem clipping ou overflow |
| Tablet | `768x900`, trajetória e cards contidos |
| Mobile | `390x844`, trajetória e navegação preservadas |
| Idiomas | português, inglês e espanhol protegidos pelo gerador |

## Estado final

O tutorial pode ser percorrido integralmente ou navegado manualmente. Nenhuma demonstração bloqueia **Próximo**; somente o nome é obrigatório. A landing page resultante está finalizada, validada e integrada ao gerador usado por novos projetos.
