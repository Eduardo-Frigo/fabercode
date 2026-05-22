const { normalizeBlueprintText } = require('./project_blueprint_utils');

function inferBlueprintBrand(source = '', contract = null) {
  if (contract && contract.brandFallback) return contract.brandFallback;
  const normalized = normalizeBlueprintText(source);
  if (/\badvocacia\b|\badvogad[oa]s?\b|\bjuridic[oa]\b|\bdireito\b/.test(normalized)) return 'Escritório Faber Advocacia';
  if (/\bveterin/.test(normalized)) return 'Clínica Faber Vet';
  if (/\bestufas?\b|\bgreenhouses?\b|\bcultivo protegido\b|\bviveiros?\b|\bhortas? comerciais?\b|\bprodutor rural\b|\bagricultura\b/.test(normalized)) return 'Estufas Protegidas';
  if (/\bbaleias?\b|\bjubartes?\b|\bhumpback\b|\bwhales?\b|\boceano\b/.test(normalized)) return 'Jubarte Azul';
  if (/\bcouro\b|\bcouros\b|\bartefatos? de couro\b|\bmarroquinaria\b|\bbolsas?\b|\bpastas?\b|\bcarteiras?\b|\bartesanal\b|\bfeito a mao\b/.test(normalized)) return 'Atelier Couro Faber';
  if (/\bfotograf/.test(normalized)) return 'Estúdio Aurora';
  if (/\bodonto|dent/.test(normalized)) return 'Clínica Sorriso';
  if (/\barquit/.test(normalized)) return 'Studio Habitat';
  return 'Faber Projeto';
}

function buildInstitutionalCopy(contract = {}) {
  const domain = contract && contract.domain ? contract.domain : '';
  const source = normalizeBlueprintText(contract && contract.source ? contract.source : '');
  if (domain === 'legal') {
    if (/\b(propriedade intelectual|marcas?|patentes?|direitos autorais|software|tecnologia|contratos de tecnologia|protecao de software)\b/.test(source)) {
      return {
        heroEyebrow: 'Propriedade intelectual e tecnologia',
        heroTitle: 'Estratégia jurídica para proteger marcas, criações e tecnologia.',
        heroText: 'Página institucional para escritório focado em propriedade intelectual, com áreas claras, método consultivo e CTA para agendar uma consulta.',
        cta: 'Agendar consulta',
        servicesHeading: 'Áreas de atuação',
        services: [
          { title: 'Marcas', description: 'Estrutura para apresentar busca, registro, oposição e gestão de portfólio de marcas.' },
          { title: 'Patentes', description: 'Blocos para invenções, desenhos industriais, estratégia de proteção e acompanhamento técnico.' },
          { title: 'Direitos autorais', description: 'Orientação para obras, conteúdo digital, licenciamento, cessão e uso autorizado.' },
          { title: 'Tecnologia e software', description: 'Contratos de tecnologia, proteção de software, confidencialidade e governança de ativos digitais.' },
        ],
        about: 'Este bloco contextualiza o escritório, sua atuação em propriedade intelectual e a forma de traduzir temas complexos em decisões jurídicas objetivas.',
        methodSteps: [
          { title: 'Diagnóstico', description: 'Mapeamento inicial dos ativos, riscos e prioridades de proteção.' },
          { title: 'Estratégia', description: 'Definição do melhor caminho jurídico, documental e operacional.' },
          { title: 'Execução', description: 'Acompanhamento de registros, contratos, notificações e respostas.' },
        ],
        statOneValue: '4',
        statOneLabel: 'frentes de propriedade intelectual',
        statTwoValue: '100%',
        statTwoLabel: 'conteúdo placeholder editável',
        testimonial: 'A página deixou marcas, tecnologia e contratos fáceis de entender em uma primeira conversa.',
        faq: [
          { question: 'Quando devo registrar uma marca?', answer: 'Antes de escalar comunicação, vendas ou parcerias que dependam daquele nome ou sinal distintivo.' },
          { question: 'Software pode ser protegido?', answer: 'Sim. A estratégia pode combinar registro, contratos, confidencialidade e documentação técnica.' },
          { question: 'Os textos são finais?', answer: 'Não. Eles são placeholders contextuais para validar layout e fluxo antes do conteúdo definitivo.' },
        ],
        contactText: 'Use este formulário como placeholder até conectar CRM, e-mail, Supabase ou outro backend.',
        formStatus: 'Solicitação placeholder registrada. Conecte este formulário ao backend real na próxima etapa.',
        metaDescription: 'Página institucional para escritório de propriedade intelectual.',
      };
    }
    return {
      heroEyebrow: 'Atendimento jurídico estratégico',
      heroTitle: 'Orientação jurídica clara para proteger decisões importantes.',
      heroText: 'Página institucional para escritório de advocacia com placeholders contextualizados, áreas de atuação e CTA para consulta jurídica.',
      cta: 'Agendar consulta jurídica',
      services: [
        { title: 'Consultoria jurídica', description: 'Análise inicial para entender riscos, prioridades e o melhor caminho jurídico.' },
        { title: 'Contratos e prevenção', description: 'Organização de documentos, acordos e orientações para reduzir conflitos futuros.' },
        { title: 'Atuação contenciosa', description: 'Acompanhamento em demandas cíveis, empresariais ou trabalhistas com comunicação objetiva.' },
      ],
      about: 'Este bloco apresenta a história do escritório, áreas de atuação, credenciais e diferenciais de atendimento jurídico.',
      statOneValue: '10+',
      statOneLabel: 'anos de experiência jurídica simulada',
      statTwoValue: '3',
      statTwoLabel: 'áreas de atuação placeholder',
      testimonial: 'O atendimento jurídico ficou fácil de entender e pronto para receber os casos reais do escritório.',
      contactText: 'Use este formulário como placeholder até conectar CRM, e-mail, Supabase ou outro backend.',
      formStatus: 'Solicitação jurídica placeholder registrada. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Página institucional placeholder para escritório de advocacia.',
    };
  }
  if (domain === 'dental') {
    return {
      heroEyebrow: 'Atendimento odontológico premium',
      heroTitle: 'Uma experiência odontológica clara para transformar visitantes em consultas.',
      heroText: 'Página institucional para clínica odontológica com placeholders contextualizados, serviços e agendamento.',
      cta: 'Agendar avaliação',
      services: [
        { title: 'Consulta odontológica', description: 'Primeiro atendimento para entender necessidades e orientar o plano de cuidado.' },
        { title: 'Tratamentos personalizados', description: 'Organização de opções como prevenção, estética e reabilitação de forma simples.' },
        { title: 'Acompanhamento', description: 'Rotina de cuidado para manter saúde bucal e confiança no sorriso.' },
      ],
      about: 'Este bloco apresenta a clínica, equipe, estrutura e diferenciais do atendimento odontológico.',
      statOneValue: '10+',
      statOneLabel: 'anos de experiência odontológica simulada',
      statTwoValue: '98%',
      statTwoLabel: 'satisfação placeholder',
      testimonial: 'A estrutura deixou a clínica odontológica fácil de entender e pronta para conteúdo real.',
      contactText: 'Use este formulário como placeholder até conectar agenda, CRM ou backend.',
      formStatus: 'Agendamento odontológico placeholder registrado. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Página institucional placeholder para clínica odontológica.',
    };
  }
  if (domain === 'veterinary') {
    return {
      heroEyebrow: 'Cuidado veterinário acolhedor',
      heroTitle: 'Uma presença digital clara para aproximar pets, tutores e atendimento.',
      heroText: 'Página institucional para clínica veterinária com placeholders contextualizados, serviços e CTA para consulta.',
      cta: 'Agendar consulta veterinária',
      services: [
        { title: 'Consulta veterinária', description: 'Atendimento inicial para avaliar saúde, rotina e necessidades do pet.' },
        { title: 'Vacinas e prevenção', description: 'Orientação para manter cuidado animal em dia com calendário simples.' },
        { title: 'Acompanhamento', description: 'Contato próximo para manter tutores informados depois da consulta.' },
      ],
      about: 'Este bloco apresenta a clínica, equipe veterinária, estrutura e diferenciais no cuidado animal.',
      statOneValue: '10+',
      statOneLabel: 'anos de cuidado animal simulado',
      statTwoValue: '98%',
      statTwoLabel: 'satisfação placeholder',
      testimonial: 'A página deixou a clínica veterinária clara e pronta para receber informações reais.',
      contactText: 'Use este formulário como placeholder até conectar agenda, WhatsApp ou backend.',
      formStatus: 'Consulta veterinária placeholder registrada. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Página institucional placeholder para clínica veterinária.',
    };
  }
  if (domain === 'humpback-whales') {
    return {
      heroEyebrow: 'Observação e conservação marinha',
      heroTitle: 'Baleias jubarte em uma experiência digital clara, azul e memorável.',
      heroText: 'Página institucional placeholder para apresentar pesquisa, educação ambiental, rotas de observação e ações de conservação oceânica.',
      cta: 'Conhecer a jornada',
      services: [
        { title: 'Educação oceânica', description: 'Conteúdo introdutório para explicar migração, comportamento e importância das baleias jubarte.' },
        { title: 'Observação responsável', description: 'Blocos para apresentar roteiros, boas práticas e experiências guiadas de forma segura.' },
        { title: 'Conservação marinha', description: 'Espaço para campanhas, pesquisa, dados e chamadas para apoio ambiental.' },
      ],
      about: 'Este bloco apresenta a missão do projeto, a relação com o oceano, a equipe ou instituição responsável e os próximos conteúdos reais.',
      statOneValue: '16m',
      statOneLabel: 'comprimento aproximado de uma jubarte adulta',
      statTwoValue: '8k km',
      statTwoLabel: 'migração anual placeholder',
      testimonial: 'A narrativa visual aproximou ciência, oceano e público em uma primeira versão pronta para refinamento.',
      contactText: 'Use este formulário como placeholder para contato, visitas, voluntariado, parcerias ou imprensa.',
      formStatus: 'Interesse placeholder registrado. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Página institucional placeholder sobre baleias jubarte, oceano e conservação marinha.',
    };
  }
  if (domain === 'leather-goods') {
    return {
      heroEyebrow: 'Couro artesanal europeu',
      heroTitle: 'Peças de couro feitas para atravessar anos.',
      heroText: 'Landing page para artefatos de couro com bolsas, pastas e acessórios apresentados por qualidade, produção artesanal e longevidade.',
      cta: 'Conhecer coleções',
      servicesHeading: 'Coleções',
      services: [
        { title: 'Bolsas de couro', description: 'Modelos para rotina, viagem e trabalho com formas limpas, costura reforçada e acabamento natural.' },
        { title: 'Pastas e office', description: 'Pastas, sleeves e organizadores para carregar documentos e tecnologia com presença discreta.' },
        { title: 'Acessórios duráveis', description: 'Carteiras, nécessaires e peças menores pensadas para ganhar textura bonita com o uso.' },
        { title: 'Sob encomenda', description: 'Adaptações de cor, ferragens e medidas para criar uma peça coerente com cada necessidade.' },
      ],
      about: 'O atelier combina seleção cuidadosa do couro, corte manual, costura precisa e acabamento feito para valorizar a matéria-prima ao longo do tempo.',
      methodSteps: [
        { title: 'Seleção do couro', description: 'Escolha de peles, tons e texturas de acordo com uso, toque e resistência esperada.' },
        { title: 'Corte e montagem', description: 'Peças cortadas e montadas em baixa escala para preservar proporção, encaixe e estrutura.' },
        { title: 'Acabamento e cuidado', description: 'Bordas, ferragens e proteção final preparados para envelhecer com elegância.' },
      ],
      statOneValue: '100%',
      statOneLabel: 'couro selecionado para uso real',
      statTwoValue: 'Feito à mão',
      statTwoLabel: 'produção artesanal em baixa escala',
      testimonial: 'As peças comunicam qualidade sem exagero e deixam claro por que o couro bem feito dura mais.',
      faq: [
        { question: 'O couro muda com o tempo?', answer: 'Sim. Couro natural ganha pátina, marcas de uso e profundidade de cor quando bem cuidado.' },
        { question: 'As peças podem ser personalizadas?', answer: 'Sim. A estrutura permite apresentar variações de cor, medida, ferragem e finalidade.' },
        { question: 'Como devo cuidar da peça?', answer: 'Evite excesso de água, guarde em local ventilado e hidrate o couro com produto adequado quando necessário.' },
      ],
      contactText: 'Use este formulário como placeholder para pedidos sob encomenda, catálogo, dúvidas de cuidado ou disponibilidade de peças.',
      formStatus: 'Interesse em peça de couro registrado. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Landing page para atelier de artefatos de couro, bolsas, pastas e produção artesanal.',
    };
  }
  if (domain === 'greenhouses') {
    return {
      heroEyebrow: 'Cultivo protegido sob medida',
      heroTitle: 'Estufas sob medida para produzir mais, com mais proteção e controle.',
      heroText: 'Projetamos estufas resistentes e eficientes para cultivo agrícola, viveiros, hortas comerciais e produção protegida durante o ano inteiro.',
      cta: 'Solicitar orçamento',
      servicesHeading: 'Modelos de estufas',
      services: [
        { title: 'Estufa Agrícola Tipo Túnel', description: 'Modelo versátil e econômico para hortaliças, mudas, flores e pequenos cultivos comerciais.' },
        { title: 'Estufa Multitúnel', description: 'Solução robusta para produtores que precisam de maior área coberta, vão interno amplo e alta capacidade produtiva.' },
        { title: 'Estufa para Viveiros', description: 'Ambiente protegido para produção de mudas com mais padronização, ventilação e possibilidade de bancadas internas.' },
        { title: 'Estufa Residencial ou Compacta', description: 'Estrutura leve para hortas domésticas, chácaras, sítios, temperos, flores e pequenos espaços de cultivo.' },
      ],
      about: 'Chuvas fortes, excesso de sol, vento, granizo, pragas e variações bruscas de temperatura podem comprometer a qualidade da colheita. Uma estufa bem projetada cria um ambiente mais controlado, protege as plantas e melhora a previsibilidade da produção.',
      methodSteps: [
        { title: 'Você solicita o orçamento', description: 'Informe tipo de cultivo, localização, área aproximada e objetivo da estufa.' },
        { title: 'Entendemos sua necessidade', description: 'Um especialista avalia modelo, estrutura, cobertura, ventilação e recursos adequados.' },
        { title: 'Proposta sob medida', description: 'Você recebe uma solução personalizada com medidas, materiais e condições comerciais.' },
        { title: 'Produção e entrega', description: 'A estrutura é preparada conforme o projeto aprovado e organizada para envio ou instalação.' },
        { title: 'Instalação ou orientação', description: 'Dependendo da região e do modelo, a montagem pode ser feita pela equipe ou acompanhada com suporte técnico.' },
      ],
      statOneValue: 'Sob medida',
      statOneLabel: 'dimensões, cobertura e ventilação adaptadas ao cultivo',
      statTwoValue: 'Ano inteiro',
      statTwoLabel: 'mais controle para plantar, manejar e colher com previsibilidade',
      testimonial: 'A estufa certa ajuda a proteger mudas, organizar a produção e reduzir a dependência do clima.',
      faq: [
        { question: 'Qual o melhor tipo de estufa para meu cultivo?', answer: 'Depende da cultura, área disponível, clima da região e objetivo de produção. A avaliação define o modelo mais adequado.' },
        { question: 'A estufa protege contra chuva e granizo?', answer: 'A cobertura reduz exposição direta à chuva e intempéries. A resistência ao granizo depende da estrutura e do tipo de cobertura escolhidos.' },
        { question: 'É possível fazer uma estufa sob medida?', answer: 'Sim. Largura, comprimento, altura, ventilação, cobertura e layout interno podem ser adaptados ao projeto.' },
        { question: 'A estufa pode receber sistema de irrigação?', answer: 'Sim. O projeto pode prever gotejamento, microaspersão, nebulização ou outros sistemas conforme o cultivo.' },
        { question: 'Qual é o prazo de entrega?', answer: 'O prazo varia conforme tamanho do projeto, localização e disponibilidade dos materiais.' },
        { question: 'Vocês fazem instalação?', answer: 'A instalação pode ser própria, enviada com orientação técnica ou definida por região e modelo de estufa.' },
      ],
      contactHeading: 'Solicite um orçamento',
      contactText: 'Conte o tipo de cultivo, cidade, área aproximada e modelo desejado para receber uma indicação técnica mais precisa.',
      formButtonLabel: 'Receber meu orçamento',
      formFields: [
        { label: 'Nome', name: 'nome', type: 'text', placeholder: 'Seu nome' },
        { label: 'WhatsApp', name: 'whatsapp', type: 'tel', placeholder: '(00) 00000-0000' },
        { label: 'Cidade e estado', name: 'cidade_estado', type: 'text', placeholder: 'Cidade - UF' },
        { label: 'Tipo de cultivo', name: 'tipo_cultivo', type: 'text', placeholder: 'Hortaliças, mudas, flores, frutas...' },
        { label: 'Tamanho aproximado da área', name: 'area', type: 'text', placeholder: 'Ex.: 8m x 30m ou 240 m²' },
        { label: 'Mensagem adicional', name: 'mensagem', type: 'textarea', rows: 4, placeholder: 'Conte o objetivo da estufa e qualquer necessidade especial' },
      ],
      formStatus: 'Recebemos sua solicitação. Em breve, um especialista entrará em contato para entender seu projeto e indicar a melhor solução.',
      metaDescription: 'Landing page para estufas agrícolas, viveiros, hortas comerciais e cultivo protegido sob medida.',
    };
  }

  return {
    heroEyebrow: 'Atendimento placeholder premium',
    heroTitle: 'Uma presença digital clara para transformar visitantes em contatos.',
    heroText: 'Primeira composição modular com conteúdo provisório, estrutura responsiva e chamada para ação pronta para evoluir.',
    cta: 'Agendar conversa',
    services: [
      { title: 'Diagnóstico inicial', description: 'Entendimento rápido da necessidade e indicação do melhor caminho.' },
      { title: 'Plano personalizado', description: 'Organização da solução com etapas simples, visuais e mensuráveis.' },
      { title: 'Acompanhamento', description: 'Contato próximo para manter a experiência confiável depois do primeiro atendimento.' },
    ],
    about: 'Este bloco usa texto placeholder para validar hierarquia, leitura e ritmo visual antes da entrada do conteúdo final.',
    statOneValue: '10+',
    statOneLabel: 'anos de experiência simulada',
    statTwoValue: '98%',
    statTwoLabel: 'satisfação placeholder',
    testimonial: 'A estrutura ficou simples de entender e pronta para receber conteúdo real.',
    contactText: 'Use este formulário como placeholder até conectar backend, CRM ou Supabase.',
    formStatus: 'Mensagem placeholder registrada. Conecte este formulário ao backend real na próxima etapa.',
    metaDescription: 'Composição modular placeholder pronta para evoluir com conteúdo real.',
  };
}


module.exports = {
  buildInstitutionalCopy,
  inferBlueprintBrand,
};
