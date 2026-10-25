# Documentos

Los documentos son su material: transcripciones de entrevistas y grupos focales, notas de campo, informes, artículos, respuestas abiertas de una encuesta. Trama trabaja con su **texto**: usted codifica palabras, oraciones y párrafos. Los archivos originales y las grabaciones se guardan, cifrados, dentro del proyecto.

<a id="import"></a>

## Importar documentos

![Importar documentos](../img/es/import.png)

Abra **Importar** en la navegación (o **Importar documentos** en la lista de documentos) y elija los archivos, o arrástrelos a la pantalla. Trama lee cada archivo y lo pone en una lista para revisarlo: seleccione uno para comprobar su nombre, cómo **Importar como** (documento o transcripción), su **Caso** y sus **Grupos de documentos**, los posibles problemas y una vista previa del texto. Desmarque los archivos que no quiera e impórtelos todos a la vez; un solo Deshacer revierte la importación entera.

La pantalla Importar ofrece también **Pegar texto** (una transcripción o unas notas copiadas de otro programa) y **Nuevo documento vacío** (para notas de campo escritas directamente en Trama); cuando ya hay archivos en la lista, están en el menú **…** junto a **Añadir archivos**. Un archivo cuyo texto ya está en el proyecto se marca como **Ya está en el proyecto** y se deja fuera, salvo que elija **Importarlo de todos modos**.

| Tipo de archivo | Extensiones | Notas |
|---|---|---|
| Texto plano | `.txt` | Cualquier codificación; los archivos que no están en UTF-8 se leen como Windows-1252 y se señalan para que revise las letras con tilde. |
| Markdown | `.md` | Se quitan las marcas de formato; el texto se conserva. |
| Word | `.docx` | Texto, títulos y listas. Las imágenes y los comentarios se dejan fuera (Trama dice cuántos). Se conserva el archivo original. |
| OpenDocument | `.odt` | Igual que Word. |
| Texto enriquecido | `.rtf` | Incluidas las páginas de códigos antiguas de Windows. |
| Página web | `.html`, `.htm` | El texto legible, sin menús ni scripts. |
| PDF | `.pdf` | La capa de texto de cada página. Se conserva el PDF original. Los PDF protegidos piden la contraseña. |
| Subtítulos | `.vtt`, `.srt` | Se leen como transcripciones con marcas de tiempo (vea más abajo). |
| Hojas de cálculo | `.csv`, `.xlsx` | Se leen como respuestas de encuestas (vea más abajo). |

Algunas cosas que conviene saber:

- Los **PDF escaneados** no tienen capa de texto, solo imágenes de las páginas. Trama indica qué páginas no tienen texto. No reconoce texto en imágenes: pase antes el escaneo por un programa de OCR, o importe una versión en Word o en texto.
- Los **nombres** salen de los nombres de los archivos. Puede cambiar el nombre de un documento en cualquier momento (`F2` en la lista).
- El **texto se guarda en forma canónica**: los saltos de línea, los caracteres invisibles y las formas Unicode se normalizan al importar, para que las posiciones sean exactas. Los párrafos se separan con saltos de línea.
- Los archivos muy grandes no son un problema. Una transcripción de un megabyte se abre y se codifica con fluidez.

<a id="transcripts"></a>

## Transcripciones y grabaciones

Trama reconoce las transcripciones y mantiene **un turno de palabra por párrafo**, escrito como `Hablante: lo que dijo`. Así es fácil codificar un turno completo, comparar hablantes y leer un grupo focal.

- Los **archivos de subtítulos** (`.vtt`, `.srt`) de Zoom, Teams, Otter o de programas de transcripción se convierten en transcripciones con una marca de tiempo en cada turno.
- Los **archivos de texto y de Word** se leen como transcripciones cuando lo parecen: líneas que empiezan con el nombre de quien habla seguido de dos puntos, o con marcas de tiempo como `[00:01:23]`. Trama es prudente: una nota de campo con líneas como `Fecha: …` sigue siendo un documento corriente. Si Trama se equivoca, cambie **Importar como** en ese archivo (**Transcripción** o **Documento**).
- Los **nombres de los hablantes** que solo se diferencian en mayúsculas (`INÉS` e `Inés`) se tratan como la misma persona. Puede cambiar los nombres antes de importar («Hablante 1» → «Entrevistadora»).
- **Codificar hablantes automáticamente** crea un código para cada hablante en una categoría llamada «Hablantes» y codifica con él todos sus turnos, para recuperar después todo lo que dijo una persona.

**Grabaciones.** Una transcripción puede llevar su audio o su vídeo. En la cabecera del documento, elija **Asociar una grabación…** y seleccione el archivo; se cifra y se guarda en el proyecto. Aparece un reproductor sobre el texto:

- `Ctrl+Space` reproduce o pausa.
- `Alt+←` y `Alt+→` retroceden o avanzan 5 segundos durante la reproducción (o cuando el reproductor tiene el foco); el resto del tiempo, `Alt+←` es **Volver**. `Alt+Shift+←` y `Alt+Shift+→` retroceden o avanzan en cualquier momento, incluso en pausa.
- `Alt+Enter` reproduce desde el párrafo donde está el cursor.
- **Seguir la grabación en el texto** resalta el turno que se está oyendo.
- Quitar una grabación borra el archivo del proyecto; la transcripción y sus marcas de tiempo se conservan.

<a id="record"></a>

## Grabar una llamada

La aplicación de escritorio puede grabar una entrevista hecha por videollamada (Zoom, Teams, Meet, Jitsi o cualquier otra) y transcribirla, todo en su ordenador. No se envía nada a ninguna parte, y no hace falta cuenta ni conexión a internet.

1. Elija **Grabar una llamada** (el botón del micrófono en la parte superior de la lista de documentos, o `Ctrl+K` y «Grabar una llamada»).
2. Dé un nombre a la grabación e indique los nombres que la transcripción debe usar para usted y para la otra parte.
3. Elija el idioma hablado, o deje que Trama lo detecte.
4. Marque **Todas las personas de la llamada han aceptado ser grabadas**. La ética de la investigación, y la ley en muchos lugares, exigen consentimiento; diga al comienzo de la llamada que está grabando. Sin esto, la grabación no empieza.
5. Elija **Empezar a grabar**.

Trama graba dos cosas: su **micrófono** y **lo que reproduce el ordenador**, es decir, a todas las demás personas de la llamada. Se guardan por separado, para que la transcripción sepa qué palabras fueron suyas. Una franja en la parte inferior de la ventana muestra cuánto dura la grabación y el nivel de sonido de cada parte; aparece un aviso si una de las partes no se está grabando. Puede seguir trabajando en Trama mientras tanto, y Trama no se bloquea solo mientras graba.

Elija **Detener y guardar**. La grabación se convierte en un documento de transcripción con su audio, cifrado como todos los demás archivos del proyecto. Si marcó **Transcribir cuando termine la grabación**, la transcripción se hace a continuación (ver más abajo).

- **Use auriculares.** Sin ellos, su micrófono también oye a la otra parte por los altavoces. Trama quita de su parte las palabras que también oyó del ordenador, pero con auriculares la transcripción queda más limpia.
- **Varias personas en la otra parte** aparecen todas con el nombre que dio a la otra parte. Después, renombre o divida sus intervenciones con **Editar el texto…**.
- **Si Trama o el ordenador se detienen** en mitad de una llamada, la grabación no se pierde. La próxima vez que abra el proyecto, lo grabado hasta los últimos segundos se guarda como documento.
- Las grabaciones se guardan como archivos WAV estéreo de 16 kHz, unos 230 MB por hora.
- **macOS** pide la primera vez permiso para usar el micrófono y para grabar el sonido del ordenador; Trama necesita los dos. Grabar requiere macOS 14.2 o posterior. En **Linux**, el sonido del ordenador se graba mediante PulseAudio o PipeWire, que usan casi todos los escritorios.

<a id="transcribe"></a>

## Transcribir una grabación

Trama incluye un modelo de voz (Whisper large-v3-turbo, mediante whisper.cpp) que transcribe una grabación en su ordenador. Entiende portugués, español, inglés y unos cien idiomas más.

- **Una llamada grabada en Trama** se transcribe cuando termina la grabación, si lo pidió.
- **Una grabación que importe sin transcripción** (un `.mp3`, `.m4a`, `.wav`, `.flac`, `.ogg` o el sonido de un vídeo `.mp4` o `.mov`) se convierte en un documento de transcripción y se transcribe después de importar.
- **Cualquier grabación aún sin transcripción**: abra el documento y elija **Transcribir en este ordenador**.

La transcripción tarda un rato: en un portátil reciente, entre la mitad y toda la duración de la grabación. Se hace en segundo plano, una grabación cada vez; una franja en la parte inferior de la ventana muestra el progreso, y puede seguir trabajando o detenerla. Si Trama se bloquea o se cierra antes, continúa la próxima vez que se abra el proyecto. Al terminar, el texto aparece en el documento, un párrafo por intervención y con marcas de tiempo, para que la grabación acompañe al texto al reproducirse. El registro de auditoría indica qué motor escribió la transcripción.

Lea la transcripción con la grabación antes de codificarla: la transcripción automática entiende mal nombres, palabras dichas en voz baja y voces que se solapan, y puede omitir una respuesta muy corta, como «Sí.», al comienzo de una intervención. Una transcripción solo se escribe en un documento que aún no tiene texto, así que nunca sustituye al suyo.

<a id="surveys"></a>

## Respuestas de encuestas

Las respuestas abiertas de un cuestionario suelen llegar en una hoja de cálculo: una fila por persona encuestada, una columna por pregunta. Importe el archivo `.csv` o `.xlsx` y Trama le preguntará cómo leerlo:

1. La **Hoja** que debe leer, en los libros con varias hojas, y un **Nombre de la encuesta** para los documentos.
2. Para cada columna, cómo **Usar como**: **Identificador** (sin él, las filas se numeran), **Respuesta abierta** (el texto que quiere codificar), **Atributo** (edad, grupo, lugar…: se convierten en [atributos de los casos](06-cases-and-attributes.md)) o **Dejar fuera**.
3. **Documentos**: **Un documento por encuestado** (cada pregunta como título, con la respuesta debajo; recomendado) o **Un documento por pregunta** (la respuesta de cada persona bajo su identificador).
4. **Crear un caso para cada encuestado**, con las columnas de atributos como atributos (solo con un documento por encuestado). Las personas que ya están en el proyecto se actualizan.
5. **Codificar cada respuesta por pregunta** crea un código para cada pregunta en una categoría llamada «Preguntas», para que «todo lo que se respondió a la pregunta 3» esté a un clic.

<a id="documents"></a>

## La lista de documentos

![La lista de documentos junto a un documento abierto](../img/es/workbench.png)

**Documentos** muestra la lista de documentos a la izquierda, el documento abierto en el centro y el libro de códigos a la derecha. Oculte cualquiera de los paneles laterales para dar más espacio al texto; arrastre los bordes para cambiar su tamaño.

- **Filtre** la lista escribiendo parte de un nombre.
- **Ordene** según su propio orden (arrastre los documentos para reorganizarlos), por nombre, por lo que tienen más codificado o por la fecha en que se añadieron.
- **Agrupe** la lista por grupo de documentos o por caso.
- Seleccione varios documentos con `Ctrl` o `Shift` y un clic, y actúe sobre todos desde el menú.
- El menú de cada documento (clic derecho, o `Shift+F10`) permite **cambiar el nombre**, **asignar el caso**, ponerlo en **grupos**, darle un **color**, abrir su **memorando**, ver sus **propiedades** (tipo, archivo original, longitud, número de segmentos codificados, cuánto texto está codificado) o **eliminarlo**.

Al eliminar un documento se eliminan también sus segmentos codificados y los memorandos sobre él. Trama dice cuántos antes de que usted confirme, y puede deshacerlo al momento.

<a id="groups"></a>

## Grupos de documentos

Un grupo de documentos reúne documentos que van juntos: las entrevistas, la primera oleada, un lugar, los documentos pendientes de codificar. Un documento puede estar en varios grupos.

- Cree un grupo desde **Grupos de documentos…** en el menú de un documento, o en la sección de grupos de la lista de documentos.
- Elija un grupo para ver solo sus documentos. Los grupos también se pueden renombrar, colorear y eliminar; eliminar un grupo nunca elimina sus documentos.
- Los grupos se usan en todo el análisis: para filtrar segmentos codificados, para comparar el uso de palabras, como columnas de una matriz código × documento y en los gráficos.

<a id="cases-link"></a>

## Documentos y casos

Un **caso** es una unidad de análisis: normalmente un participante, a veces un lugar, un hogar o una organización. Cada documento puede pertenecer a un caso; un caso puede tener varios documentos (dos entrevistas a la misma persona, por ejemplo). Asigne el caso de un documento desde su menú (**Asignar caso…**): escriba para encontrar un caso, o escriba un nombre nuevo para crearlo.

Los casos tienen **atributos** como la edad, el rol o el barrio, que permiten comparar grupos de personas. Tienen [un capítulo propio](06-cases-and-attributes.md).
