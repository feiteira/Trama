# Intercambiar proyectos

Su trabajo nunca debería quedar atrapado en un programa. Trama lee y escribe **REFI-QDA**, el estándar abierto de intercambio entre programas de análisis cualitativo, así que puede llevar un proyecto de Trama a NVivo, MAXQDA, ATLAS.ti, QualCoder, Quirkos o Transana, y al revés. Su propio archivo `.trama` es un archivo ZIP sencillo, en formatos abiertos, que se puede leer sin Trama.

<a id="refi-qda"></a>

## REFI-QDA en pocas palabras

REFI-QDA define dos archivos:

- un archivo de **proyecto**, `.qdpx`: documentos, códigos, segmentos codificados, memorandos, casos, atributos, grupos de documentos y codificadores;
- un archivo de **libro de códigos**, `.qdc`: códigos con su jerarquía, sus colores y sus definiciones (consulte [Exportar e importar un libro de códigos](04-codebook.md#codebook-files)).

Los programas difieren en lo que pueden guardar, así que inevitablemente se pierde algo en cada sentido. Trama muestra siempre un resumen de lo que no se ha podido conservar, para que nada se pierda en silencio.

<a id="import-qdpx"></a>

## Traer un proyecto desde otro programa

1. En el otro programa, exporte el proyecto a REFI-QDA: busque **REFI-QDA** o **QDPX** en sus opciones de exportación o de uso compartido.
2. En Trama, en la pantalla de proyectos, elija **Importar un archivo de proyecto** y seleccione el archivo `.qdpx`. Se convierte en un proyecto nuevo de su biblioteca, cifrado como los demás.
3. Lea el resumen de lo que se ha importado y de lo que no.

Trama averigua cómo contó cada programa las posiciones en el texto (los programas cuentan de forma distinta los saltos de línea y los caracteres especiales), comprobándolo con los propios pasajes codificados, para que las codificaciones caigan sobre las palabras correctas.

**Desde ATLAS.ti**, los códigos con nombres como `Padre::Hijo` pueden conservarse tal cual o convertirse en una jerarquía. **Desde NVivo**, los nodos de caso se convierten en casos y las anotaciones en memorandos sobre el pasaje anotado; NVivo no exporta los colores de los códigos, así que Trama les da colores de su paleta. **Desde MAXQDA**, los casos sin nombre toman el nombre de su primer documento, los valores de atributos de los documentos pasan al caso del documento, y los memorandos sobre selecciones se convierten en memorandos del documento que citan el texto seleccionado.

<a id="export-qdpx"></a>

## Llevar un proyecto a otro programa

Abra **Proyecto**, pase a la pestaña **Exportar**, elija **Proyecto REFI-QDA** y guarde el archivo `.qdpx`. Después, impórtelo en el otro programa.

- **Finales de línea para MAXQDA** es la única opción: escribe los archivos de texto con finales de línea de Windows para que los segmentos codificados queden en su sitio en MAXQDA. Actívela cuando el archivo vaya a MAXQDA y déjela desactivada para otros programas.
- Los memorandos y las grabaciones se incluyen siempre.
- Los PDF originales cuyo texto ha editado se escriben siempre como texto (consulte [Qué no se conserva](#lost)).

El archivo `.qdpx` **no está cifrado** y nunca contiene la clave de seudonimización, los elementos eliminados ni el registro de auditoría.

<a id="carries-over"></a>

## Qué se conserva

| | Hacia Trama | Desde Trama |
|---|---|---|
| Documentos (texto) | Sí | Sí |
| Archivos PDF y Word originales | Se guardan como archivo original | Los PDF cuyo texto no se ha editado |
| Transcripciones con marcas de tiempo y grabaciones | Sí | Sí (las marcas de tiempo necesitan la grabación) |
| Códigos, jerarquía, colores | Sí | Sí |
| Definiciones de los códigos | Sí | Sí, con *cuándo usar*, *cuándo no usar* y *ejemplo* como partes rotuladas de la descripción |
| Segmentos codificados en el texto, con codificadores y comentarios | Sí | Sí |
| Memorandos sobre el proyecto, documentos, códigos y segmentos codificados | Sí | Sí |
| Memorandos de casos | Sí | Sí, como enlace del memorando al caso |
| Casos, atributos y valores | Sí | Sí |
| Grupos de documentos | A partir de conjuntos de documentos | Como conjuntos de documentos |
| Codificadores | Sí | Sí |

<a id="lost"></a>

## Qué no se conserva

**Al entrar**, Trama solo codifica texto, así que estos elementos se dejan fuera y aparecen en el resumen:

- áreas codificadas en páginas PDF, imágenes y sus codificaciones, y codificaciones de intervalos de tiempo en audio o vídeo (las codificaciones del texto de la transcripción sí entran);
- archivos a los que el `.qdpx` hace referencia pero que no contiene (Trama nunca busca nada en una ruta del disco ni en la red);
- conjuntos de códigos y de memorandos, grafos y redes, enlaces que no asocian un memorando y referencias a códigos en casos;
- valores de atributos que no encajan con su tipo, y la parte de la hora de los valores de fecha y hora;
- codificaciones de códigos que no existen, con posiciones imposibles o duplicadas.

**Al salir**, el otro programa no recibe:

- los atributos de **Opción** como opciones: pasan a ser texto, porque REFI-QDA no tiene listas de valores permitidos;
- los colores de casos, grupos, memorandos y documentos, las teclas de atajo de los códigos y los tipos de documento *encuesta* y *nota* (pasan a ser documentos de texto corrientes);
- el registro de auditoría, los elementos eliminados y la clave de seudonimización;
- el PDF original de un documento cuyo texto ha editado (seudonimizado, por ejemplo). El original seguiría mostrando lo que se quitó, así que el documento se escribe siempre como texto.

La correspondencia completa, para los más curiosos, está en `docs/spec/refi-qda.md` en el código fuente de Trama.

<a id="trama-file"></a>

## El archivo `.trama`

Un archivo `.trama` contiene un proyecto completo, sin pérdidas: los documentos con sus archivos originales y grabaciones, el libro de códigos, los segmentos codificados, los memorandos, los casos y atributos, los grupos de documentos y el registro de auditoría. Trama lo usa para:

- **Proyecto → Exportar → Archivo de proyecto Trama**: para guardar una copia, archivar un estudio terminado o cambiar de ordenador;
- **copias para compañeros** ([Trabajo en equipo](08-teamwork-and-agreement.md#copies));
- **copias de seguridad automáticas**, que siempre están cifradas ([Copias de seguridad](10-privacy-and-security.md#backups)).

Al exportar, puede **proteger el archivo con una contraseña** (muy recomendable cuando sale de su ordenador) y elegir si **incluir la clave de seudonimización** (se deja fuera de forma predeterminada). Los archivos exportados solo indican que los elementos eliminados se eliminaron, nunca su contenido.

Por dentro, un archivo `.trama` sin contraseña es un archivo ZIP corriente: los datos en líneas JSON, los archivos originales y una carpeta `readable` con cada documento en texto plano, el libro de códigos en Markdown y cada memorando en un archivo Markdown, para que un proyecto siga siendo legible durante décadas, con o sin Trama. Un archivo protegido con contraseña es ese mismo archivo ZIP, cifrado.

Importe un archivo `.trama` con **Importar un archivo de proyecto** en la pantalla de proyectos.
