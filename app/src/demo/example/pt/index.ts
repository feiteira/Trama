import type { ExampleContent } from '../types';
import { documents } from './documents';

export const pt: ExampleContent = {
  project: {
    name: 'Crescer juntos — hortas comunitárias e bem-estar',
    description:
      'Um estudo fictício de exemplo: entrevistas, um grupo focal, notas de campo e respostas a um inquérito de três hortas comunitárias de uma cidade imaginária. Explore à vontade; nada disto é real.',
  },
  coders: { researcher: 'Ana', second: 'Rui' },
  speakers: { interviewer: 'Entrevistadora', moderator: 'Moderadora' },
  groups: { interviews: 'Entrevistas', focus: 'Grupo focal e notas' },
  attributes: {
    age: { name: 'Idade', description: 'Idade em anos à data da entrevista.' },
    gender: { name: 'Género', description: 'Conforme indicado pelo participante.' },
    years: { name: 'Anos na horta', description: 'Anos de participação na horta comunitária.' },
    neighbourhood: { name: 'Bairro', description: 'Onde fica a horta do participante.' },
    role: { name: 'Papel', description: 'Papel principal na horta.' },
  },
  options: {
    gender: ['Mulher', 'Homem', 'Não binário'],
    neighbourhood: ['Vale das Amoreiras', 'Ribeira Nova', 'Alto do Moinho'],
    role: ['Titular de talhão', 'Voluntariado', 'Coordenação'],
  },
  surveyQuestions: [
    'O que mudou na sua vida, se é que mudou alguma coisa, desde que começou na horta?',
    'O que tornaria a horta melhor para si?',
  ],
  cases: {
    p1: { name: 'Marta', description: 'Reformada; viúva há quatro anos. Titular de talhão no Vale das Amoreiras quase desde o início da horta.' },
    p2: { name: 'Tiago', description: 'Chefe de turno num centro logístico; mudou-se para a Ribeira Nova há três anos.' },
    p3: { name: 'Helena', description: 'Coordenadora da horta do Vale das Amoreiras; trabalha a tempo parcial.' },
    p4: { name: 'Joaquim', description: 'Antigo operário da fábrica de tijolo; o hortelão mais antigo do Alto do Moinho.' },
    p5: { name: 'Amina', description: 'Chegou há três anos; voluntária na mesa de boas-vindas do talhão do grupo.' },
    p6: { name: 'Paulo', description: 'Chegou por prescrição social depois de ser despedido; organiza o grupo de voluntários de terça-feira.' },
    r1: { name: 'R01', description: 'Respondente do inquérito.' },
    r2: { name: 'R02', description: 'Respondente do inquérito.' },
    r3: { name: 'R03', description: 'Respondente do inquérito.' },
    r4: { name: 'R04', description: 'Respondente do inquérito.' },
    r5: { name: 'R05', description: 'Respondente do inquérito.' },
  },
  codes: {
    community: {
      name: 'Pertença e comunidade',
      description: 'Como a horta liga as pessoas umas às outras: quem está dentro, quem fica de fora, e como isso muda.',
      inclusion: '', exclusion: '', example: '',
    },
    belonging: {
      name: 'Pertença',
      description: 'Sentir-se parte da horta ou do bairro; ser aceite, conhecido ou sentido como falta.',
      inclusion: 'Referências a amizade, aceitação, ser conhecido pelo nome, sentir-se em casa.',
      exclusion: 'As primeiras semanas de alguém novo (usar Recém-chegados); trocas entre gerações (usar Trocas intergeracionais).',
      example: '“Aqui ninguém precisa dos meus papéis. As batatas não querem saber de onde eu sou.” (Amina)',
    },
    intergenerational: {
      name: 'Trocas intergeracionais',
      description: 'Saberes, ajuda ou cuidado que passam entre pessoas mais velhas e mais novas, nos dois sentidos.',
      inclusion: 'Ensinar, aprender ou fazer juntos quando a diferença de idade é relevante para quem fala.',
      exclusion: 'Saber de cultivo partilhado entre pares (usar Saber sazonal).',
      example: '“Eu ensinei-o a guardar sementes de tomate. Troca justa, digo eu.” (Marta)',
    },
    conflict: {
      name: 'Conflitos sobre talhões',
      description: 'Disputas sobre talhões, limites, água, espaços e equipamentos comuns, ou sobre quem merece um talhão.',
      inclusion: 'Discussões, queixas, acusações, furtos, tensões entre grupos de hortelãos.',
      exclusion: 'Desacordos apenas sobre as regras, sem disputa entre pessoas (usar Regras e governação).',
      example: '“A abóbora de alguém cresce para cima do caminho e de repente é uma guerra.” (Jamal, grupo focal)',
    },
    newcomers: {
      name: 'Recém-chegados',
      description: 'Chegar à horta: primeiras impressões, timidez, aprender as regras não escritas, ser ou não bem recebido.',
      inclusion: 'Relatos da própria chegada ou de como os novos membros são vistos pelos outros.',
      exclusion: 'Recém-chegados ao bairro em geral (usar Mudança no bairro).',
      example: '“Mas fiquei vinte minutos sentado no carro cá fora.” (Paulo)',
    },
    wellbeing: {
      name: 'Bem-estar',
      description: 'Efeitos da horta na saúde física e mental, tal como os participantes os descrevem.',
      inclusion: '', exclusion: '', example: '',
    },
    stress: {
      name: 'Alívio do stress',
      description: 'A horta como pausa das preocupações, do trabalho ou do ruído; calma, descanso para a cabeça.',
      inclusion: 'Calma, desligar, ansiedade aliviada, “a cabeça descansa”.',
      exclusion: 'Tristeza depois de uma morte ou perda (usar Luto e perda).',
      example: '“É a única altura em que a minha cabeça se cala.” (Paulo)',
    },
    physical: {
      name: 'Atividade física',
      description: 'Esforço físico, forma, mobilidade e sono ligados ao trabalho na horta.',
      inclusion: 'Cavar, carregar, mexer-se para se manter bem, estar fisicamente cansado.',
      exclusion: 'Referências a serviços de saúde (usar Apoio municipal).',
      example: '“Mexer-se é o que nos mantém. Quem para, enferruja, como uma fechadura velha.” (Joaquim)',
    },
    grief: {
      name: 'Luto e perda',
      description: 'Morte, separação e outras perdas, e o lugar da horta na forma de viver com elas.',
      inclusion: 'Morte do cônjuge ou de um familiar, ida de alguém próximo para um lar, luto à distância.',
      exclusion: 'Perda do emprego (usar Sentido de propósito) ou do bairro de antigamente (usar Mudança no bairro).',
      example: '“Passou a ser o sítio onde eu podia estar triste sem ninguém fazer alarido.” (Marta)',
    },
    purpose: {
      name: 'Sentido de propósito',
      description: 'Uma razão para se levantar, uma rotina, ser útil aos outros.',
      inclusion: 'Estrutura da semana, responsabilidade, retribuir, trabalho com significado.',
      exclusion: 'Exercício por si só (usar Atividade física).',
      example: '“Voltou a dar forma à semana.” (Paulo)',
    },
    food: {
      name: 'Alimentação e sustentabilidade',
      description: 'O que a horta produz e o que as pessoas aprendem sobre a comida e as estações.',
      inclusion: '', exclusion: '', example: '',
    },
    foodSecurity: {
      name: 'Segurança alimentar',
      description: 'Os produtos da horta como parte real da alimentação de um agregado, ou de apoio alimentar.',
      inclusion: 'Dinheiro poupado, famílias que contam com os produtos, mercearias sociais, cabazes.',
      exclusion: 'Oferecer produtos como gesto (usar Partilha de produtos).',
      example: '“Se o talhão desaparecesse, notávamos logo na caixa do supermercado.” (Rosa, grupo focal)',
    },
    sharing: {
      name: 'Partilha de produtos',
      description: 'Dar, trocar e cozinhar juntos o que se colhe.',
      inclusion: 'Bancas de excedentes, sacos no portão, trocas entre talhões, refeições partilhadas.',
      exclusion: 'Apoio alimentar organizado em que o que conta é a necessidade (usar Segurança alimentar).',
      example: '“Fazemos trocas. Eu dou-lhes favas, eles dão-me endro.” (Joaquim)',
    },
    seasonal: {
      name: 'Saber sazonal',
      description: 'Saber quando e como cultivar, como se aprende, e como as alterações do clima o abalam.',
      inclusion: 'Épocas de sementeira, sinais da natureza, conselhos de outros hortelãos, comer de acordo com a época.',
      exclusion: 'Aprendizagens que dizem respeito à relação entre gerações (usar Trocas intergeracionais).',
      example: '“O calendário que vem no pacote foi escrito para outra terra.” (Joaquim)',
    },
    place: {
      name: 'Lugar e natureza',
      description: 'A horta enquanto lugar: os seres vivos que a habitam e o bairro à sua volta.',
      inclusion: '', exclusion: '', example: '',
    },
    nature: {
      name: 'Contacto com a natureza',
      description: 'Aves, animais, plantas, tempo e luz notados e valorizados por si mesmos.',
      inclusion: 'Descrições da vida selvagem, do charco, das manhãs cedo, da horta como “igreja”.',
      exclusion: 'O tempo enquanto problema de cultivo (usar Saber sazonal).',
      example: '“Neblina nos canteiros, o melro a cantar, uma raposa a atravessar o caminho como se fosse dona disto.” (Joaquim)',
    },
    change: {
      name: 'Mudança no bairro',
      description: 'Como a zona à volta da horta mudou: encerramentos, prédios novos, gente nova.',
      inclusion: 'Fábricas, tascas e centros comunitários que fecharam; cafés e prédios novos.',
      exclusion: 'Subida das rendas e expulsão de moradores (usar o subcódigo Gentrificação).',
      example: '“A tasca fechou, o centro comunitário agora são apartamentos.” (Paulo)',
    },
    gentrification: {
      name: 'Gentrificação',
      description: 'Subida do custo da habitação, saída forçada de moradores e pressão sobre os terrenos, e como os participantes se posicionam.',
      inclusion: 'Rendas, não conseguir pagar para ficar, pressão imobiliária sobre o terreno da horta, culpa ou ressentimento.',
      exclusion: 'Mudança sem custo ou expulsão em causa (usar Mudança no bairro).',
      example: '“Eu sei que pessoas como eu fazem parte do problema.” (Tiago)',
    },
    organisation: {
      name: 'Organização',
      description: 'Como a horta é gerida: regras, direção, voluntários e apoio externo.',
      inclusion: '', exclusion: '', example: '',
    },
    rules: {
      name: 'Regras e governação',
      description: 'Regras escritas e não escritas, decisões da direção, vistorias e a forma como as regras são explicadas.',
      inclusion: 'Criar, fazer cumprir, contornar ou não perceber regras; compromissos alcançados pela direção.',
      exclusion: 'A disputa que deu origem a uma regra (usar Conflitos sobre talhões).',
      example: '“As regras estão bem desde que alguém as explique.” (Pedro, grupo focal)',
    },
    waitingList: {
      name: 'Lista de espera',
      description: 'Esperar por um talhão, e como os lugares são atribuídos.',
      inclusion: 'Tempo de espera, exceções à ordem de inscrição.',
      exclusion: '',
      example: '“Agora há uma lista de espera que nunca mais acaba.” (Marta)',
    },
    municipal: {
      name: 'Apoio municipal',
      description: 'Apoio, ou falta dele, da Câmara, da junta e de outros serviços públicos (financiamento, água, terreno, encaminhamentos).',
      inclusion: 'Apoios, cortes, reparações, visitas de técnicos, encaminhamentos do centro de saúde e prescrição social.',
      exclusion: 'Apoio entre os próprios hortelãos (usar Pertença).',
      example: '“São muito bons a mandar folhetos e pouco bons a mandar canalizadores.” (Marta)',
    },
    burden: {
      name: 'Sobrecarga do voluntariado',
      description: 'O peso de gerir a horta a recair sobre poucas pessoas.',
      inclusion: 'Horas dadas, esgotamento, sentir-se indispensável, culpa de quem faz menos.',
      exclusion: 'O esforço normal de tratar do próprio talhão (usar Atividade física).',
      example: '“Se três pessoas saíssem amanhã, não sei se a horta sobrevivia.” (Helena)',
    },
  },
  documents,
  memos: [
    {
      target: { kind: 'project' },
      title: 'Perguntas de investigação',
      body: [
        '## Perguntas de investigação',
        '',
        '1. De que forma as hortas comunitárias moldam o sentimento de **pertença** dos participantes em bairros que estão a mudar depressa?',
        '2. Que benefícios para o **bem-estar** descrevem os participantes, e quem parece beneficiar mais?',
        '3. De que forma a **organização** das hortas (regras, voluntários, apoio da Câmara) torna esses benefícios possíveis, ou os limita?',
        '',
        '## Material',
        '',
        '- Seis entrevistas semiestruturadas (duas codificadas também pelo Rui, para a concordância entre codificadores)',
        '- Um grupo focal na horta da Ribeira Nova',
        '- Notas de campo do dia aberto do Vale das Amoreiras',
        '- Cinco respostas abertas a um inquérito',
        '',
        'Todos os nomes são pseudónimos. Os consentimentos informados estão guardados à parte, não neste projeto.',
      ].join('\n'),
    },
    {
      target: { kind: 'code', code: 'belonging' },
      title: 'Pertença sem perguntas',
      body:
        'Vários participantes descrevem a pertença como *não lhes fazerem perguntas*: a Amina (“ninguém precisa dos meus papéis”), a Marta (“ninguém disse uma palavra, deixaram-me estar”), o Paulo (“ninguém me pediu para falar dos meus sentimentos”). A pertença constrói-se aqui **a trabalhar lado a lado**, não a conversar. Ver se isto se confirma nas respostas ao inquérito.',
    },
    {
      target: { kind: 'code', code: 'burden' },
      title: 'Quem carrega a horta?',
      body:
        'Os mesmos poucos nomes aparecem uma e outra vez (a Helena, o Paulo, as “mesmas cinco pessoas” do R05). O bem-estar que a horta dá a muitos parece assentar no trabalho não pago de poucos, alguns dos quais vieram precisamente pelo seu próprio bem-estar. Tema possível: **o custo do cuidado**. Comparar os relatos de quem coordena e de quem só tem talhão.',
    },
    {
      target: { kind: 'document', doc: 'int3' },
      title: 'Entrevista 3: o olhar da coordenação',
      body:
        'A Helena é a única entrevistada que vê a horta sobretudo por dentro da sua organização. Muito do que os outros chamam “as regras” ou “a direção” é, no relato dela, uma pessoa a atender o telefone às dez e meia da noite. A exceção para quem vem encaminhado pelo centro de saúde é um bom exemplo de como as regras transportam valores (“nós não somos só um clube de legumes”).',
    },
    {
      target: { kind: 'document', doc: 'focus' },
      title: 'Grupo focal: dinâmica',
      body:
        'O Pedro fala sobretudo do clima e das regras; a Rosa traz sempre a conversa de volta à comida e ao dinheiro. A disputa da água foi claramente dolorosa para a Rosa e o grupo mudou de assunto depressa. O Jamal faz de ponte entre hortelãos antigos e novos, tal como o Tiago se descreve a si próprio na entrevista 2.',
    },
    {
      target: { kind: 'case', case: 'p1' },
      title: 'Marta',
      body:
        'Viúva há quatro anos. A horta aparece como lugar para fazer o luto “sem ninguém fazer alarido” e como estrutura do dia (“um sítio para onde ir de manhã”). O relato da discussão sobre o barracão liga os conflitos sobre espaços comuns à memória e à perda. A seguir: quer envolver-se no dia aberto do próximo ano?',
    },
    {
      target: { kind: 'coding', doc: 'int6', code: 'burden', quote: 'Estive quase a ir abaixo outra vez. O que é irónico, tendo em conta a razão por que vim.' },
      title: 'A horta terapêutica que esgota',
      body:
        'O próprio Paulo dá nome ao paradoxo: o lugar que o ajudou a recuperar é agora uma fonte de desgaste. Procurar o mesmo padrão na Helena (entrevista 3) e no R05. Pode tornar-se um argumento central sobre os limites da prescrição social sem pessoal pago.',
    },
    {
      target: { kind: 'coding', doc: 'int5', code: 'belonging', quote: 'Aqui ninguém precisa dos meus papéis. As batatas não querem saber de onde eu sou.' },
      title: 'Pertença como alívio do escrutínio',
      body:
        'A Amina contrapõe a horta a “os papéis, a repartição, o médico”. A pertença define-se por oposição ao escrutínio institucional. Isto é Pertença, ou precisa de um código próprio sobre instituições? Discutir na próxima reunião de codificação.',
    },
  ],
};
