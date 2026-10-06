# Trocar projetos

O seu trabalho nunca deve ficar preso a um programa. O Trama lê e escreve **REFI-QDA**, o padrão aberto de troca entre programas de análise qualitativa, por isso pode levar um projeto do Trama para o NVivo, o MAXQDA, o ATLAS.ti, o QualCoder, o Quirkos ou o Transana, e vice-versa. O seu próprio ficheiro `.trama` é um arquivo ZIP simples, em formatos abertos, que se pode ler sem o Trama.

<a id="refi-qda"></a>

## O REFI-QDA em resumo

O REFI-QDA define dois ficheiros:

- um ficheiro de **projeto**, `.qdpx` — documentos, códigos, segmentos codificados, memorandos, casos, atributos, grupos de documentos e codificadores;
- um ficheiro de **livro de códigos**, `.qdc` — códigos com a hierarquia, as cores e as definições (ver [Exportar e importar um livro de códigos](04-codebook.md#codebook-files)).

Os programas diferem no que conseguem guardar, por isso perde-se inevitavelmente alguma coisa em cada sentido. O Trama mostra sempre um resumo do que não foi possível passar, para que nada se perca em silêncio.

<a id="import-qdpx"></a>

## Trazer um projeto de outro programa

1. No outro programa, exporte o projeto para REFI-QDA: procure **REFI-QDA** ou **QDPX** nas opções de exportação ou de partilha.
2. No Trama, no ecrã de projetos, escolha **Importar um ficheiro de projeto** e escolha o ficheiro `.qdpx`. Torna-se um projeto novo na sua biblioteca, cifrado como os outros.
3. Leia o resumo do que foi importado e do que não foi.

O Trama descobre como cada programa contou as posições no texto (os programas diferem na forma de contar quebras de linha e caracteres especiais), verificando-o nas próprias passagens codificadas, para que as codificações caiam nas palavras certas.

**Do ATLAS.ti**, os códigos com nomes como `Pai::Filho` podem ficar como estão ou ser transformados numa hierarquia. **Do NVivo**, os nós de caso tornam-se casos e as anotações tornam-se memorandos sobre a passagem anotada; o NVivo não exporta as cores dos códigos, por isso o Trama atribui-lhes cores da sua paleta. **Do MAXQDA**, os casos sem nome ficam com o nome do primeiro documento, os valores de atributos nos documentos passam para o caso do documento, e os memorandos sobre seleções tornam-se memorandos do documento que citam o texto selecionado.

<a id="export-qdpx"></a>

## Levar um projeto para outro programa

Abra **Projeto**, passe ao separador **Exportar**, escolha **Projeto REFI-QDA** e guarde o ficheiro `.qdpx`. Depois, importe-o no outro programa.

- **Fins de linha para o MAXQDA** é a única opção: escreve os ficheiros de texto com fins de linha do Windows, para que os segmentos codificados fiquem no sítio certo no MAXQDA. Ative-a quando o ficheiro for para o MAXQDA e deixe-a desativada para outros programas.
- Os memorandos e as gravações são sempre incluídos.
- Os PDF originais cujo texto editou são sempre escritos como texto (ver [O que não passa](#lost)).

O ficheiro `.qdpx` **não é cifrado** e nunca contém a chave de pseudonimização, os itens eliminados nem o registo de auditoria.

<a id="carries-over"></a>

## O que passa

| | Para o Trama | Do Trama |
|---|---|---|
| Documentos (texto) | Sim | Sim |
| Ficheiros PDF e Word originais | Guardados como ficheiro original | Os PDF cujo texto não foi editado |
| Transcrições com marcas de tempo e gravações | Sim | Sim (as marcas de tempo precisam da gravação) |
| Códigos, hierarquia, cores | Sim | Sim |
| Definições dos códigos | Sim | Sim, com *quando usar*, *quando não usar* e *exemplo* como partes identificadas da descrição |
| Segmentos codificados no texto, com codificadores e comentários | Sim | Sim |
| Memorandos sobre o projeto, documentos, códigos e segmentos codificados | Sim | Sim |
| Memorandos de casos | Sim | Sim, como ligação do memorando ao caso |
| Casos, atributos e valores | Sim | Sim |
| Grupos de documentos | A partir de conjuntos de documentos | Como conjuntos de documentos |
| Codificadores | Sim | Sim |

<a id="lost"></a>

## O que não passa

**Ao entrar**, o Trama só codifica texto, por isso estes elementos ficam de fora e aparecem no resumo:

- áreas codificadas em páginas de PDF, imagens e as suas codificações, e codificações de intervalos de tempo em áudio ou vídeo (as codificações do texto da transcrição entram);
- ficheiros a que o `.qdpx` se refere mas que não contém (o Trama nunca vai buscar nada a um caminho no disco nem à rede);
- conjuntos de códigos e de memorandos, grafos e redes, ligações que não associam um memorando, e referências a códigos em casos;
- valores de atributos que não correspondem ao tipo, e a parte da hora em valores de data e hora;
- codificações de códigos que não existem, com posições impossíveis, ou duplicadas.

**Ao sair**, o outro programa não recebe:

- os atributos de **Escolha** como escolhas: passam a texto, porque o REFI-QDA não tem listas de valores permitidos;
- as cores de casos, grupos, memorandos e documentos, as teclas de atalho dos códigos e os tipos de documento *inquérito* e *nota* (passam a documentos de texto comuns);
- o registo de auditoria, os itens eliminados e a chave de pseudonimização;
- o PDF original de um documento cujo texto editou — pseudonimizado, por exemplo. O original continuaria a mostrar o que foi removido, por isso o documento é sempre escrito como texto.

O mapeamento completo, para os mais curiosos, está em `docs/spec/refi-qda.md` no código-fonte do Trama.

<a id="trama-file"></a>

## O ficheiro `.trama`

Um ficheiro `.trama` contém um projeto inteiro, sem perdas: os documentos com os ficheiros originais e as gravações, o livro de códigos, os segmentos codificados, os memorandos, os casos e atributos, os grupos de documentos e o registo de auditoria. O Trama usa-o para:

- **Projeto → Exportar → Ficheiro de projeto Trama** — para guardar uma cópia, arquivar um estudo terminado ou mudar de computador;
- **cópias para colegas** ([Trabalho em equipa](08-teamwork-and-agreement.md#copies));
- **cópias de segurança automáticas**, que são sempre cifradas ([Cópias de segurança](10-privacy-and-security.md#backups)).

Ao exportar, pode **proteger o ficheiro com uma palavra-passe** (muito recomendado quando sai do seu computador) e escolher se quer **incluir a chave de pseudonimização** (fica de fora por omissão). Os ficheiros exportados só indicam que os itens eliminados foram eliminados, nunca o seu conteúdo.

Por dentro, um ficheiro `.trama` sem palavra-passe é um arquivo ZIP comum: os dados em linhas JSON, os ficheiros originais e uma pasta `readable` com cada documento em texto simples, o livro de códigos em Markdown e cada memorando num ficheiro Markdown — para que um projeto continue legível durante décadas, com ou sem o Trama. Um ficheiro protegido com palavra-passe é esse mesmo arquivo, cifrado.

Importe um ficheiro `.trama` com **Importar um ficheiro de projeto** no ecrã de projetos.
