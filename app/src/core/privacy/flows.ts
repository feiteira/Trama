import type { UiLocale } from '../i18n/languages';

// Every way data can leave the computer. This single list feeds Settings → "What leaves this
// computer" and PRIVACY.md (npm run gen:privacy), so the two cannot drift apart. A feature
// that writes data anywhere outside the library must add an entry here.

export interface FlowText {
  title: string;
  when: string;
  what: string;
  who: string;
}

export const FLOW_IDS = [
  'backup', 'trama', 'teammate', 'qdpx', 'codebook', 'segments', 'memos', 'analysis', 'cases', 'audit', 'agreement', 'report', 'pseudonyms', 'clipboard',
] as const;
export type FlowId = (typeof FLOW_IDS)[number];

export interface Flow {
  id: FlowId;
  /** 'setting': happens on its own once set up; 'action': only when you do it. */
  trigger: 'setting' | 'action';
  /** Whether what leaves is encrypted. */
  encrypted: 'always' | 'optional' | 'never';
  text: Record<UiLocale, FlowText>;
}

export const FLOWS: readonly Flow[] = [
  {
    id: 'backup',
    trigger: 'setting',
    encrypted: 'always',
    text: {
      en: {
        title: 'Automatic backups',
        when: 'Only after you choose a backup folder for a project: when the project opens, once a day while it is open, when you choose Back up now, and when you lock Trama or close the project if anything changed.',
        what: 'The whole project — documents, original files and recordings, codes, coded segments, memos, cases, the pseudonymisation key and the audit trail, deleted items included — encrypted as one .trama file in the folder you chose (a USB drive, a network or cloud-drive folder). Older backups are thinned out and removed after the history length you choose.',
        who: 'Only someone who knows your passphrase or recovery phrase. Anyone who can open the folder sees that backup files exist, with their dates and sizes, but not what is in them.',
      },
      pt: {
        title: 'Cópias de segurança automáticas',
        when: 'Só depois de escolher uma pasta para as cópias de um projeto: quando o projeto abre, uma vez por dia enquanto estiver aberto, quando escolhe Fazer cópia agora e quando bloqueia o Trama ou fecha o projeto, se algo mudou.',
        what: 'Todo o projeto — documentos, ficheiros originais e gravações, códigos, segmentos codificados, memorandos, casos, a chave de pseudonimização e o registo de auditoria, incluindo o que foi eliminado — cifrado num único ficheiro .trama na pasta que escolheu (uma pen USB, uma pasta de rede ou da sua nuvem). As cópias mais antigas vão sendo espaçadas e são removidas ao fim do período de histórico que escolher.',
        who: 'Apenas quem souber a sua frase-passe ou a sua frase de recuperação. Quem tiver acesso à pasta vê que existem ficheiros de cópia, com as datas e os tamanhos, mas não o seu conteúdo.',
      },
      es: {
        title: 'Copias de seguridad automáticas',
        when: 'Solo después de elegir una carpeta para las copias de un proyecto: al abrir el proyecto, una vez al día mientras esté abierto, cuando elige Hacer copia ahora y al bloquear Trama o cerrar el proyecto, si algo ha cambiado.',
        what: 'Todo el proyecto — documentos, archivos originales y grabaciones, códigos, segmentos codificados, memorandos, casos, la clave de seudonimización y el registro de auditoría, incluido lo eliminado — cifrado en un único archivo .trama en la carpeta que eligió (un USB, una carpeta de red o de su nube). Las copias más antiguas se van espaciando y se eliminan al terminar el periodo de historial que elija.',
        who: 'Solo quien conozca su frase de contraseña o su frase de recuperación. Quien pueda abrir la carpeta ve que existen archivos de copia, con sus fechas y tamaños, pero no su contenido.',
      },
    },
  },
  {
    id: 'trama',
    trigger: 'action',
    encrypted: 'optional',
    text: {
      en: {
        title: 'Project file (.trama)',
        when: 'Only when you choose Export → Trama project file.',
        what: 'The whole project — documents, original files and recordings, codes, coded segments, memos, cases and the audit trail — without the content of anything deleted. Original files of documents edited since import (pseudonymised ones, for example) are left out, and so are file names and audit-trail wording that could still hold a name the pseudonymisation key replaced. The pseudonymisation key only if you switch it on.',
        who: 'Anyone who has the file — unless you protect it with a password; then only someone who knows the password.',
      },
      pt: {
        title: 'Ficheiro de projeto (.trama)',
        when: 'Só quando escolhe Exportar → Ficheiro de projeto Trama.',
        what: 'Todo o projeto — documentos, ficheiros originais e gravações, códigos, segmentos codificados, memorandos, casos e o registo de auditoria — sem o conteúdo do que foi eliminado. Os ficheiros originais de documentos editados depois da importação (por exemplo, pseudonimizados) ficam de fora, tal como os nomes de ficheiros e as entradas do registo de auditoria que ainda possam conter um nome substituído pela chave de pseudonimização. A chave de pseudonimização só se a incluir.',
        who: 'Quem tiver o ficheiro — a menos que o proteja com uma palavra-passe; nesse caso, só quem a souber.',
      },
      es: {
        title: 'Archivo de proyecto (.trama)',
        when: 'Solo cuando elige Exportar → Archivo de proyecto Trama.',
        what: 'Todo el proyecto — documentos, archivos originales y grabaciones, códigos, segmentos codificados, memorandos, casos y el registro de auditoría — sin el contenido de lo eliminado. Los archivos originales de documentos editados después de la importación (por ejemplo, seudonimizados) se quedan fuera, igual que los nombres de archivo y las entradas del registro de auditoría que aún puedan contener un nombre sustituido por la clave de seudonimización. La clave de seudonimización solo si la incluye.',
        who: 'Quien tenga el archivo — salvo que lo proteja con una contraseña; en ese caso, solo quien la conozca.',
      },
    },
  },
  {
    id: 'teammate',
    trigger: 'action',
    encrypted: 'optional',
    text: {
      en: {
        title: 'Copy for a teammate',
        when: 'Only when you make a copy for a teammate (Agreement).',
        what: 'The same as a project file (.trama), kept as the same project so that your teammate’s coding can be merged back into yours.',
        who: 'Anyone who has the file, unless you protect it with a password (suggested by default).',
      },
      pt: {
        title: 'Cópia para um colega',
        when: 'Só quando faz uma cópia para um colega (Concordância).',
        what: 'O mesmo que um ficheiro de projeto (.trama), mantido como o mesmo projeto para que a codificação do seu colega possa ser integrada na sua.',
        who: 'Quem tiver o ficheiro, a menos que o proteja com uma palavra-passe (proposta por omissão).',
      },
      es: {
        title: 'Copia para un compañero',
        when: 'Solo cuando hace una copia para un compañero (Acuerdo).',
        what: 'Lo mismo que un archivo de proyecto (.trama), conservado como el mismo proyecto para que la codificación de su compañero pueda integrarse en la suya.',
        who: 'Quien tenga el archivo, salvo que lo proteja con una contraseña (propuesta por defecto).',
      },
    },
  },
  {
    id: 'qdpx',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'REFI-QDA project (.qdpx)',
        when: 'Only when you choose Export → REFI-QDA project.',
        what: 'Documents as text, original PDF and Word files whose text is unchanged, recordings, codes, coded segments, memos, cases and attributes, document groups and coder names. Never the pseudonymisation key, deleted items or the audit trail. Not encrypted.',
        who: 'Anyone who has the file, and the program you open it in (NVivo, MAXQDA, ATLAS.ti…).',
      },
      pt: {
        title: 'Projeto REFI-QDA (.qdpx)',
        when: 'Só quando escolhe Exportar → Projeto REFI-QDA.',
        what: 'Documentos como texto, PDF e ficheiros Word originais cujo texto não mudou, gravações, códigos, segmentos codificados, memorandos, casos e atributos, grupos de documentos e nomes dos codificadores. Nunca a chave de pseudonimização, o que foi eliminado nem o registo de auditoria. Sem cifra.',
        who: 'Quem tiver o ficheiro e o programa onde o abrir (NVivo, MAXQDA, ATLAS.ti…).',
      },
      es: {
        title: 'Proyecto REFI-QDA (.qdpx)',
        when: 'Solo cuando elige Exportar → Proyecto REFI-QDA.',
        what: 'Documentos como texto, PDF y archivos de Word originales cuyo texto no ha cambiado, grabaciones, códigos, segmentos codificados, memorandos, casos y atributos, grupos de documentos y nombres de los codificadores. Nunca la clave de seudonimización, lo eliminado ni el registro de auditoría. Sin cifrar.',
        who: 'Quien tenga el archivo y el programa en que lo abra (NVivo, MAXQDA, ATLAS.ti…).',
      },
    },
  },
  {
    id: 'codebook',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Codebook (.qdc, Word, CSV, Excel, Markdown)',
        when: 'Only when you export the codebook.',
        what: 'Code names, hierarchy and colours, definitions, inclusion and exclusion criteria and examples (which may quote your material), and how often each code is used. No document text. Not encrypted.',
        who: 'Anyone who has the file.',
      },
      pt: {
        title: 'Livro de códigos (.qdc, Word, CSV, Excel, Markdown)',
        when: 'Só quando exporta o livro de códigos.',
        what: 'Nomes, hierarquia e cores dos códigos, definições, critérios de inclusão e de exclusão e exemplos (que podem citar o seu material), e quantas vezes cada código é usado. Sem o texto dos documentos. Sem cifra.',
        who: 'Quem tiver o ficheiro.',
      },
      es: {
        title: 'Libro de códigos (.qdc, Word, CSV, Excel, Markdown)',
        when: 'Solo cuando exporta el libro de códigos.',
        what: 'Nombres, jerarquía y colores de los códigos, definiciones, criterios de inclusión y exclusión y ejemplos (que pueden citar su material), y cuántas veces se usa cada código. Sin el texto de los documentos. Sin cifrar.',
        who: 'Quien tenga el archivo.',
      },
    },
  },
  {
    id: 'segments',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Coded segments (CSV, Excel, Word, HTML)',
        when: 'Only when you export coded segments (Coded segments → Export). Copying them to the clipboard is described below.',
        what: 'The coded text itself, with its document, code, coder and comment and, if you choose, the text around it. Not encrypted.',
        who: 'Anyone who has the file, and the program you open it in.',
      },
      pt: {
        title: 'Segmentos codificados (CSV, Excel, Word, HTML)',
        when: 'Só quando exporta segmentos codificados (Segmentos codificados → Exportar). A cópia para a área de transferência está descrita mais abaixo.',
        what: 'O próprio texto codificado, com o documento, o código, o codificador e o comentário e, se escolher, o texto à volta. Sem cifra.',
        who: 'Quem tiver o ficheiro e o programa onde o abrir.',
      },
      es: {
        title: 'Segmentos codificados (CSV, Excel, Word, HTML)',
        when: 'Solo cuando exporta segmentos codificados (Segmentos codificados → Exportar). La copia al portapapeles se describe más abajo.',
        what: 'El propio texto codificado, con su documento, código, codificador y comentario y, si lo elige, el texto de alrededor. Sin cifrar.',
        who: 'Quien tenga el archivo y el programa en que lo abra.',
      },
    },
  },
  {
    id: 'memos',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Memos (Word, Markdown)',
        when: 'Only when you export memos (Memos → Export).',
        what: 'The memos you export: their titles and text, what each is about (a document, code, coded segment or case, by name) and who wrote it when. Not encrypted.',
        who: 'Anyone who has the file.',
      },
      pt: {
        title: 'Memorandos (Word, Markdown)',
        when: 'Só quando exporta memorandos (Memorandos → Exportar).',
        what: 'Os memorandos que exportar: títulos e texto, a que se referem (um documento, código, segmento codificado ou caso, pelo nome) e quem os escreveu e quando. Sem cifra.',
        who: 'Quem tiver o ficheiro.',
      },
      es: {
        title: 'Memorandos (Word, Markdown)',
        when: 'Solo cuando exporta memorandos (Memorandos → Exportar).',
        what: 'Los memorandos que exporte: títulos y texto, a qué se refieren (un documento, código, segmento codificado o caso, por su nombre) y quién los escribió y cuándo. Sin cifrar.',
        who: 'Quien tenga el archivo.',
      },
    },
  },
  {
    id: 'analysis',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Analysis results (CSV, Excel, SVG, PNG)',
        when: 'Only when you export a result or a chart from Analysis.',
        what: 'What the result shows: counts by code, document, document group, case or attribute, word frequencies, and — for a text search — every match with the words around it. Charts as pictures. Not encrypted.',
        who: 'Anyone who has the file, and the program you open it in.',
      },
      pt: {
        title: 'Resultados de análise (CSV, Excel, SVG, PNG)',
        when: 'Só quando exporta um resultado ou um gráfico da Análise.',
        what: 'O que o resultado mostra: contagens por código, documento, grupo de documentos, caso ou atributo, frequências de palavras e — numa pesquisa de texto — cada ocorrência com as palavras à volta. Gráficos como imagens. Sem cifra.',
        who: 'Quem tiver o ficheiro e o programa onde o abrir.',
      },
      es: {
        title: 'Resultados de análisis (CSV, Excel, SVG, PNG)',
        when: 'Solo cuando exporta un resultado o un gráfico desde Análisis.',
        what: 'Lo que muestra el resultado: recuentos por código, documento, grupo de documentos, caso o atributo, frecuencias de palabras y — en una búsqueda de texto — cada coincidencia con las palabras de alrededor. Gráficos como imágenes. Sin cifrar.',
        who: 'Quien tenga el archivo y el programa en que lo abra.',
      },
    },
  },
  {
    id: 'cases',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Cases table (CSV, Excel)',
        when: 'Only when you export the cases table (Cases → Export).',
        what: 'Each case’s name and description, its documents’ names, its attribute values (age, role… which may describe a participant) and how many coded segments it has. Not encrypted.',
        who: 'Anyone who has the file, and the spreadsheet program you open it in.',
      },
      pt: {
        title: 'Tabela de casos (CSV, Excel)',
        when: 'Só quando exporta a tabela de casos (Casos → Exportar).',
        what: 'O nome e a descrição de cada caso, os nomes dos seus documentos, os valores dos atributos (idade, função… que podem descrever um participante) e quantos segmentos codificados tem. Sem cifra.',
        who: 'Quem tiver o ficheiro e a folha de cálculo onde o abrir.',
      },
      es: {
        title: 'Tabla de casos (CSV, Excel)',
        when: 'Solo cuando exporta la tabla de casos (Casos → Exportar).',
        what: 'El nombre y la descripción de cada caso, los nombres de sus documentos, los valores de sus atributos (edad, función… que pueden describir a un participante) y cuántos segmentos codificados tiene. Sin cifrar.',
        who: 'Quien tenga el archivo y la hoja de cálculo en que lo abra.',
      },
    },
  },
  {
    id: 'audit',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Audit trail (CSV)',
        when: 'Only when you export the audit trail (Audit trail → Export CSV).',
        what: 'The entries shown: when, which coder, what was done, and the names it concerns (documents, codes, cases…). Never the pseudonymisation key: the trail only counts replacements, and entries written before the key was applied are exported without the names it replaced. Not encrypted.',
        who: 'Anyone who has the file, and the spreadsheet program you open it in.',
      },
      pt: {
        title: 'Registo de auditoria (CSV)',
        when: 'Só quando exporta o registo de auditoria (Registo de auditoria → Exportar CSV).',
        what: 'As entradas mostradas: quando, que codificador, o que foi feito e os nomes a que se refere (documentos, códigos, casos…). Nunca a chave de pseudonimização: o registo só conta as substituições, e as entradas escritas antes de a chave ser aplicada são exportadas sem os nomes que ela substituiu. Sem cifra.',
        who: 'Quem tiver o ficheiro e a folha de cálculo onde o abrir.',
      },
      es: {
        title: 'Registro de auditoría (CSV)',
        when: 'Solo cuando exporta el registro de auditoría (Registro de auditoría → Exportar CSV).',
        what: 'Las entradas mostradas: cuándo, qué codificador, qué se hizo y los nombres a los que se refiere (documentos, códigos, casos…). Nunca la clave de seudonimización: el registro solo cuenta las sustituciones, y las entradas escritas antes de aplicar la clave se exportan sin los nombres que esta sustituyó. Sin cifrar.',
        who: 'Quien tenga el archivo y la hoja de cálculo en que lo abra.',
      },
    },
  },
  {
    id: 'agreement',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Agreement report (Word, HTML, Excel, CSV)',
        when: 'Only when you export the results of comparing two coders (Agreement → Export).',
        what: 'The coders’ names, agreement statistics by code and by document, and — in Word, HTML and Excel — the passages they disagree on, quoting the coded text. Not encrypted.',
        who: 'Anyone who has the file.',
      },
      pt: {
        title: 'Relatório de concordância (Word, HTML, Excel, CSV)',
        when: 'Só quando exporta os resultados da comparação de dois codificadores (Concordância → Exportar).',
        what: 'Os nomes dos codificadores, as estatísticas de concordância por código e por documento e — em Word, HTML e Excel — as passagens em que discordam, citando o texto codificado. Sem cifra.',
        who: 'Quem tiver o ficheiro.',
      },
      es: {
        title: 'Informe de acuerdo (Word, HTML, Excel, CSV)',
        when: 'Solo cuando exporta los resultados de comparar dos codificadores (Acuerdo → Exportar).',
        what: 'Los nombres de los codificadores, las estadísticas de acuerdo por código y por documento y — en Word, HTML y Excel — los pasajes en que discrepan, citando el texto codificado. Sin cifrar.',
        who: 'Quien tenga el archivo.',
      },
    },
  },
  {
    id: 'report',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Project report (Word, HTML)',
        when: 'Only when you choose Export → Project report.',
        what: 'An overview of the project (documents, coders, counts), the codebook with definitions and how often each code is used, the memos and the cases table with attribute values. No document text. Not encrypted.',
        who: 'Anyone who has the file.',
      },
      pt: {
        title: 'Relatório do projeto (Word, HTML)',
        when: 'Só quando escolhe Exportar → Relatório do projeto.',
        what: 'Uma visão geral do projeto (documentos, codificadores, contagens), o livro de códigos com definições e quantas vezes cada código é usado, os memorandos e a tabela de casos com os valores dos atributos. Sem o texto dos documentos. Sem cifra.',
        who: 'Quem tiver o ficheiro.',
      },
      es: {
        title: 'Informe del proyecto (Word, HTML)',
        when: 'Solo cuando elige Exportar → Informe del proyecto.',
        what: 'Un resumen del proyecto (documentos, codificadores, recuentos), el libro de códigos con definiciones y cuántas veces se usa cada código, los memorandos y la tabla de casos con los valores de los atributos. Sin el texto de los documentos. Sin cifrar.',
        who: 'Quien tenga el archivo.',
      },
    },
  },
  {
    id: 'pseudonyms',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Pseudonymisation key',
        when: 'Only when you export it (Pseudonymisation → Export key), or switch it on when you export a .trama file. Encrypted backups always hold it.',
        what: 'Each real name or detail and the pseudonym that replaced it — the link back to who your participants are. Not encrypted when exported as a table.',
        who: 'Anyone who has the file. Keep it apart from the pseudonymised data, as your ethics approval and data-protection rules ask.',
      },
      pt: {
        title: 'Chave de pseudonimização',
        when: 'Só quando a exporta (Pseudonimização → Exportar chave) ou a inclui ao exportar um ficheiro .trama. As cópias de segurança cifradas incluem-na sempre.',
        what: 'Cada nome ou dado real e o pseudónimo que o substituiu — a ligação a quem são os seus participantes. Sem cifra quando exportada como tabela.',
        who: 'Quem tiver o ficheiro. Guarde-a separada dos dados pseudonimizados, como pedem a sua aprovação ética e as regras de proteção de dados.',
      },
      es: {
        title: 'Clave de seudonimización',
        when: 'Solo cuando la exporta (Seudonimización → Exportar clave) o la incluye al exportar un archivo .trama. Las copias de seguridad cifradas siempre la incluyen.',
        what: 'Cada nombre o dato real y el seudónimo que lo sustituyó — el vínculo con quiénes son sus participantes. Sin cifrar cuando se exporta como tabla.',
        who: 'Quien tenga el archivo. Guárdela separada de los datos seudonimizados, como piden su aprobación ética y las normas de protección de datos.',
      },
    },
  },
  {
    id: 'clipboard',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Copying to the clipboard',
        when: 'Only when you copy something: coded segments with their sources, your recovery phrase while you write it down, the details of an error, or where Trama keeps its data (Settings).',
        what: 'The text you copied, held in the computer’s clipboard until you copy something else.',
        who: 'Other programs on this computer, and your other devices if your system shares the clipboard with them.',
      },
      pt: {
        title: 'Copiar para a área de transferência',
        when: 'Só quando copia algo: segmentos codificados com as suas fontes, a sua frase de recuperação enquanto a anota, os detalhes de um erro, ou onde o Trama guarda os dados (Definições).',
        what: 'O texto que copiou, guardado na área de transferência do computador até copiar outra coisa.',
        who: 'Outros programas deste computador, e os seus outros dispositivos se o sistema partilhar com eles a área de transferência.',
      },
      es: {
        title: 'Copiar al portapapeles',
        when: 'Solo cuando copia algo: segmentos codificados con sus fuentes, su frase de recuperación mientras la anota, los detalles de un error, o dónde guarda Trama sus datos (Ajustes).',
        what: 'El texto que copió, guardado en el portapapeles del ordenador hasta que copie otra cosa.',
        who: 'Otros programas de este ordenador, y sus otros dispositivos si el sistema comparte con ellos el portapapeles.',
      },
    },
  },
];

export const NO_NETWORK: Record<UiLocale, string> = {
  en: 'Trama makes no network connections at all: there is no account, no cloud, no update check, no analytics, telemetry or crash reports. Your projects stay on this computer, encrypted. Data leaves it only in the ways below, and each time because you set it up or asked for it.',
  pt: 'O Trama não faz nenhuma ligação à rede: não há conta, nuvem, procura de atualizações, estatísticas de utilização, telemetria nem relatórios de erros. Os seus projetos ficam neste computador, cifrados. Os dados só saem dele das formas indicadas abaixo, e sempre porque as configurou ou pediu.',
  es: 'Trama no realiza ninguna conexión de red: no hay cuenta, nube, búsqueda de actualizaciones, analíticas, telemetría ni informes de errores. Sus proyectos se quedan en este ordenador, cifrados. Los datos solo salen de él de las formas indicadas abajo, y siempre porque usted las configuró o las pidió.',
};

/** Headings shared by the in-app page and PRIVACY.md. */
export const PRIVACY_HEAD: Record<UiLocale, { title: string; intro: string; when: string; what: string; who: string }> = {
  en: {
    title: 'What leaves this computer',
    intro: 'Trama keeps your research on your computer. This is the complete list of the ways anything can leave it.',
    when: 'When',
    what: 'What',
    who: 'Who can read it',
  },
  pt: {
    title: 'O que sai deste computador',
    intro: 'O Trama guarda a sua investigação no seu computador. Esta é a lista completa das formas de alguma coisa sair dele.',
    when: 'Quando',
    what: 'O quê',
    who: 'Quem pode ler',
  },
  es: {
    title: 'Qué sale de este ordenador',
    intro: 'Trama guarda su investigación en su ordenador. Esta es la lista completa de las formas en que algo puede salir de él.',
    when: 'Cuándo',
    what: 'Qué',
    who: 'Quién puede leerlo',
  },
};

const LANGS: readonly [UiLocale, string][] = [
  ['en', 'English'],
  ['pt', 'Português (Portugal)'],
  ['es', 'Español (España)'],
];

/** GitHub's heading anchor: lower case, punctuation dropped, spaces as hyphens. */
export function headingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** PRIVACY.md, in the three languages. */
export function privacyMarkdown(): string {
  let md = '# Privacy · Privacidade · Privacidad\n\n<!-- Generated by `npm run gen:privacy` from app/src/core/privacy/flows.ts. Do not edit by hand. -->\n\n';
  md += LANGS.map(([l, name]) => `[${name}](#${headingAnchor(PRIVACY_HEAD[l].title)})`).join(' · ') + '\n';
  for (const [l] of LANGS) {
    const h = PRIVACY_HEAD[l];
    md += `\n## ${h.title}\n\n${h.intro}\n\n${NO_NETWORK[l]}\n\n| | ${h.when} | ${h.what} | ${h.who} |\n|---|---|---|---|\n`;
    for (const f of FLOWS) {
      const t = f.text[l];
      md += `| **${cell(t.title)}** | ${cell(t.when)} | ${cell(t.what)} | ${cell(t.who)} |\n`;
    }
  }
  return md;
}
