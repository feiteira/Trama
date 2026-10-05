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

export const FLOW_IDS = ['backup', 'trama', 'teammate', 'qdpx', 'codebook', 'tables', 'reports', 'pseudonyms', 'clipboard'] as const;
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
        what: 'The whole project — documents, original files and recordings, codes, coded segments, memos, cases and the audit trail — without the content of anything deleted. The pseudonymisation key only if you switch it on.',
        who: 'Anyone who has the file — unless you protect it with a password; then only someone who knows the password.',
      },
      pt: {
        title: 'Ficheiro de projeto (.trama)',
        when: 'Só quando escolhe Exportar → Ficheiro de projeto Trama.',
        what: 'Todo o projeto — documentos, ficheiros originais e gravações, códigos, segmentos codificados, memorandos, casos e o registo de auditoria — sem o conteúdo do que foi eliminado. A chave de pseudonimização só se a incluir.',
        who: 'Quem tiver o ficheiro — a menos que o proteja com uma palavra-passe; nesse caso, só quem a souber.',
      },
      es: {
        title: 'Archivo de proyecto (.trama)',
        when: 'Solo cuando elige Exportar → Archivo de proyecto Trama.',
        what: 'Todo el proyecto — documentos, archivos originales y grabaciones, códigos, segmentos codificados, memorandos, casos y el registro de auditoría — sin el contenido de lo eliminado. La clave de seudonimización solo si la incluye.',
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
        what: 'Documents as text, original PDFs whose text is unchanged, recordings, codes, coded segments, memos, cases and attributes, document groups and coder names. Never the pseudonymisation key, deleted items or the audit trail. Not encrypted.',
        who: 'Anyone who has the file, and the program you open it in (NVivo, MAXQDA, ATLAS.ti…).',
      },
      pt: {
        title: 'Projeto REFI-QDA (.qdpx)',
        when: 'Só quando escolhe Exportar → Projeto REFI-QDA.',
        what: 'Documentos como texto, PDFs originais cujo texto não mudou, gravações, códigos, segmentos codificados, memorandos, casos e atributos, grupos de documentos e nomes dos codificadores. Nunca a chave de pseudonimização, o que foi eliminado nem o registo de auditoria. Sem cifra.',
        who: 'Quem tiver o ficheiro e o programa onde o abrir (NVivo, MAXQDA, ATLAS.ti…).',
      },
      es: {
        title: 'Proyecto REFI-QDA (.qdpx)',
        when: 'Solo cuando elige Exportar → Proyecto REFI-QDA.',
        what: 'Documentos como texto, PDF originales cuyo texto no ha cambiado, grabaciones, códigos, segmentos codificados, memorandos, casos y atributos, grupos de documentos y nombres de los codificadores. Nunca la clave de seudonimización, lo eliminado ni el registro de auditoría. Sin cifrar.',
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
    id: 'tables',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Tables (CSV, Excel)',
        when: 'Only when you export a table: coded segments, cases and attributes, query results, agreement results or the audit trail.',
        what: 'What the table shows — for coded segments, the coded text itself with its document and code. Not encrypted.',
        who: 'Anyone who has the file, and the spreadsheet program you open it in.',
      },
      pt: {
        title: 'Tabelas (CSV, Excel)',
        when: 'Só quando exporta uma tabela: segmentos codificados, casos e atributos, resultados de consultas, resultados de concordância ou o registo de auditoria.',
        what: 'O que a tabela mostra — nos segmentos codificados, o próprio texto codificado, com o documento e o código. Sem cifra.',
        who: 'Quem tiver o ficheiro e a folha de cálculo onde o abrir.',
      },
      es: {
        title: 'Tablas (CSV, Excel)',
        when: 'Solo cuando exporta una tabla: segmentos codificados, casos y atributos, resultados de consultas, resultados de acuerdo o el registro de auditoría.',
        what: 'Lo que muestra la tabla — en los segmentos codificados, el propio texto codificado, con su documento y su código. Sin cifrar.',
        who: 'Quien tenga el archivo y la hoja de cálculo en que lo abra.',
      },
    },
  },
  {
    id: 'reports',
    trigger: 'action',
    encrypted: 'never',
    text: {
      en: {
        title: 'Reports (Word, HTML)',
        when: 'Only when you export a report: the project report, the codebook, coded segments or agreement results.',
        what: 'What the report shows — the project report holds the overview, the codebook with definitions and counts, memos and the case table; a segment report holds coded text. Not encrypted.',
        who: 'Anyone who has the file.',
      },
      pt: {
        title: 'Relatórios (Word, HTML)',
        when: 'Só quando exporta um relatório: o relatório do projeto, o livro de códigos, segmentos codificados ou resultados de concordância.',
        what: 'O que o relatório mostra — o relatório do projeto tem a visão geral, o livro de códigos com definições e contagens, os memorandos e a tabela de casos; um relatório de segmentos tem texto codificado. Sem cifra.',
        who: 'Quem tiver o ficheiro.',
      },
      es: {
        title: 'Informes (Word, HTML)',
        when: 'Solo cuando exporta un informe: el informe del proyecto, el libro de códigos, segmentos codificados o resultados de acuerdo.',
        what: 'Lo que muestra el informe — el informe del proyecto incluye el resumen, el libro de códigos con definiciones y recuentos, los memorandos y la tabla de casos; un informe de segmentos incluye texto codificado. Sin cifrar.',
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
        when: 'Only when you copy something: coded segments with their sources, your recovery phrase while you write it down, or the details of an error.',
        what: 'The text you copied, held in the computer’s clipboard until you copy something else.',
        who: 'Other programs on this computer, and your other devices if your system shares the clipboard with them.',
      },
      pt: {
        title: 'Copiar para a área de transferência',
        when: 'Só quando copia algo: segmentos codificados com as suas fontes, a sua frase de recuperação enquanto a anota, ou os detalhes de um erro.',
        what: 'O texto que copiou, guardado na área de transferência do computador até copiar outra coisa.',
        who: 'Outros programas deste computador, e os seus outros dispositivos se o sistema partilhar com eles a área de transferência.',
      },
      es: {
        title: 'Copiar al portapapeles',
        when: 'Solo cuando copia algo: segmentos codificados con sus fuentes, su frase de recuperación mientras la anota, o los detalles de un error.',
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
