import type { ExampleContent } from '../types';
import { documents } from './documents';

export const es: ExampleContent = {
  project: {
    name: 'Crecer juntos — huertos comunitarios y bienestar',
    description:
      'Un estudio ficticio de ejemplo: entrevistas, un grupo focal, notas de campo y respuestas a una encuesta de tres huertos comunitarios de una ciudad imaginaria. Explórelo con total libertad; nada de esto es real.',
  },
  coders: { researcher: 'Ana', second: 'Raúl' },
  speakers: { interviewer: 'Entrevistadora', moderator: 'Moderadora' },
  groups: { interviews: 'Entrevistas', focus: 'Grupo focal y notas' },
  attributes: {
    age: { name: 'Edad', description: 'Edad en años en el momento de la entrevista.' },
    gender: { name: 'Género', description: 'Según lo indica cada participante.' },
    years: { name: 'Años en el huerto', description: 'Años de participación en el huerto comunitario.' },
    neighbourhood: { name: 'Barrio', description: 'Dónde está el huerto de cada participante.' },
    role: { name: 'Rol', description: 'Rol principal en el huerto.' },
  },
  options: {
    gender: ['Mujer', 'Hombre', 'No binario'],
    neighbourhood: ['Las Moreras', 'Ribera Nueva', 'Cerro del Molino'],
    role: ['Titular de parcela', 'Voluntariado', 'Coordinación'],
  },
  surveyQuestions: [
    '¿Qué ha cambiado en su vida, si es que ha cambiado algo, desde que empezó en el huerto?',
    '¿Qué haría que el huerto fuera mejor para usted?',
  ],
  cases: {
    p1: { name: 'Carmen', description: 'Jubilada; viuda desde hace cuatro años. Titular de parcela en Las Moreras casi desde los inicios del huerto.' },
    p2: { name: 'Javier', description: 'Jefe de turno en un centro logístico; se mudó a Ribera Nueva hace tres años.' },
    p3: { name: 'Elena', description: 'Coordinadora del huerto de Las Moreras; trabaja a media jornada.' },
    p4: { name: 'Ramón', description: 'Antiguo trabajador de la fábrica de ladrillos; el hortelano más veterano del Cerro del Molino.' },
    p5: { name: 'Amina', description: 'Llegó hace tres años; voluntaria en la mesa de bienvenida de la parcela del grupo.' },
    p6: { name: 'Luis', description: 'Llegó por prescripción social tras un despido; organiza el grupo de voluntarios de los martes.' },
    r1: { name: 'R01', description: 'Persona encuestada.' },
    r2: { name: 'R02', description: 'Persona encuestada.' },
    r3: { name: 'R03', description: 'Persona encuestada.' },
    r4: { name: 'R04', description: 'Persona encuestada.' },
    r5: { name: 'R05', description: 'Persona encuestada.' },
  },
  codes: {
    community: {
      name: 'Pertenencia y comunidad',
      description: 'Cómo el huerto conecta a las personas entre sí: quién está dentro, quién se queda fuera y cómo cambia eso.',
      inclusion: '', exclusion: '', example: '',
    },
    belonging: {
      name: 'Pertenencia',
      description: 'Sentirse parte del huerto o del barrio; ser aceptado, conocido o echado de menos.',
      inclusion: 'Referencias a amistad, aceptación, ser conocido por el nombre, sentirse como en casa.',
      exclusion: 'Las primeras semanas de alguien nuevo (usar Recién llegados); intercambios entre generaciones (usar Intercambio intergeneracional).',
      example: '«Aquí nadie necesita mis papeles. A las patatas les da igual de dónde soy». (Amina)',
    },
    intergenerational: {
      name: 'Intercambio intergeneracional',
      description: 'Saberes, ayuda o cuidados que pasan entre personas mayores y jóvenes, en ambos sentidos.',
      inclusion: 'Enseñar, aprender o hacer algo juntos cuando la diferencia de edad importa a quien habla.',
      exclusion: 'Saber hortícola compartido entre iguales (usar Saber estacional).',
      example: '«Yo le enseñé a guardar semillas de tomate. Un trato justo, digo yo». (Carmen)',
    },
    conflict: {
      name: 'Conflictos por las parcelas',
      description: 'Disputas por parcelas, lindes, agua, espacios y equipamientos comunes, o por quién merece una parcela.',
      inclusion: 'Discusiones, quejas, acusaciones, robos, tensiones entre grupos de hortelanos.',
      exclusion: 'Desacuerdos solo sobre las normas, sin disputa entre personas (usar Normas y gobernanza).',
      example: '«La calabaza de alguien invade el camino y de repente es la guerra». (Jamal, grupo focal)',
    },
    newcomers: {
      name: 'Recién llegados',
      description: 'Llegar al huerto: primeras impresiones, timidez, aprender las normas no escritas, ser bien recibido o no.',
      inclusion: 'Relatos de la propia llegada o de cómo ven los demás a los nuevos miembros.',
      exclusion: 'Recién llegados al barrio en general (usar Cambio en el barrio).',
      example: '«Pero me quedé veinte minutos sentado en el coche ahí fuera». (Luis)',
    },
    wellbeing: {
      name: 'Bienestar',
      description: 'Efectos del huerto en la salud física y mental, tal como los describen los participantes.',
      inclusion: '', exclusion: '', example: '',
    },
    stress: {
      name: 'Alivio del estrés',
      description: 'El huerto como pausa de las preocupaciones, el trabajo o el ruido; calma, descanso para la cabeza.',
      inclusion: 'Calma, desconectar, ansiedad aliviada, «la cabeza descansa».',
      exclusion: 'Tristeza tras una muerte o una pérdida (usar Duelo y pérdida).',
      example: '«Es el único momento en que se me calla la cabeza». (Luis)',
    },
    physical: {
      name: 'Actividad física',
      description: 'Esfuerzo físico, forma, movilidad y sueño ligados al trabajo en el huerto.',
      inclusion: 'Cavar, cargar, moverse para estar bien, estar cansado físicamente.',
      exclusion: 'Referencias a servicios de salud (usar Apoyo municipal).',
      example: '«Moverse es lo que te mantiene. Si te paras, te oxidas, como una cerradura vieja». (Ramón)',
    },
    grief: {
      name: 'Duelo y pérdida',
      description: 'Muertes, separaciones y otras pérdidas, y el lugar del huerto en la forma de vivir con ellas.',
      inclusion: 'Muerte de la pareja o de un familiar, ingreso de un ser querido en una residencia, duelo a distancia.',
      exclusion: 'Pérdida del empleo (usar Sentido de propósito) o del barrio de antes (usar Cambio en el barrio).',
      example: '«Se convirtió en el sitio donde podía estar triste sin que nadie montara un drama». (Carmen)',
    },
    purpose: {
      name: 'Sentido de propósito',
      description: 'Un motivo para levantarse, una rutina, ser útil a los demás.',
      inclusion: 'Estructura de la semana, responsabilidad, devolver lo recibido, trabajo con sentido.',
      exclusion: 'El ejercicio en sí mismo (usar Actividad física).',
      example: '«Le volvió a dar forma a la semana». (Luis)',
    },
    food: {
      name: 'Alimentación y sostenibilidad',
      description: 'Lo que produce el huerto y lo que la gente aprende sobre la comida y las estaciones.',
      inclusion: '', exclusion: '', example: '',
    },
    foodSecurity: {
      name: 'Seguridad alimentaria',
      description: 'La cosecha del huerto como parte real de la alimentación de un hogar, o de la ayuda alimentaria.',
      inclusion: 'Dinero ahorrado, familias que cuentan con la verdura, bancos de alimentos, cajas de verdura.',
      exclusion: 'Regalar verdura como gesto (usar Compartir la cosecha).',
      example: '«Si nos quitaran la parcela, lo notaríamos en la caja del súper». (Rosa, grupo focal)',
    },
    sharing: {
      name: 'Compartir la cosecha',
      description: 'Regalar, intercambiar y cocinar juntos lo que se cosecha.',
      inclusion: 'Mesas de excedentes, bolsas en la verja, trueques entre parcelas, comidas compartidas.',
      exclusion: 'Ayuda alimentaria organizada en la que lo que cuenta es la necesidad (usar Seguridad alimentaria).',
      example: '«Hacemos trueque. Yo les doy habas, ellos me dan eneldo». (Ramón)',
    },
    seasonal: {
      name: 'Saber estacional',
      description: 'Saber cuándo y cómo cultivar, cómo se aprende y cómo lo trastoca el cambio climático.',
      inclusion: 'Épocas de siembra, señales de la naturaleza, consejos de otros hortelanos, comer de temporada.',
      exclusion: 'Aprendizajes que tratan de la relación entre generaciones (usar Intercambio intergeneracional).',
      example: '«El calendario del sobre está escrito para otra tierra». (Ramón)',
    },
    place: {
      name: 'Lugar y naturaleza',
      description: 'El huerto como lugar: los seres vivos que lo habitan y el barrio que lo rodea.',
      inclusion: '', exclusion: '', example: '',
    },
    nature: {
      name: 'Contacto con la naturaleza',
      description: 'Aves, animales, plantas, tiempo y luz que se perciben y se valoran por sí mismos.',
      inclusion: 'Descripciones de la fauna, la charca, las primeras horas de la mañana, el huerto como «iglesia».',
      exclusion: 'El tiempo como problema para el cultivo (usar Saber estacional).',
      example: '«Neblina en los bancales, el mirlo cantando, un zorro cruzando el camino como si fuera el dueño». (Ramón)',
    },
    change: {
      name: 'Cambio en el barrio',
      description: 'Cómo ha cambiado la zona alrededor del huerto: cierres, edificios nuevos, gente nueva.',
      inclusion: 'Fábricas, bares y centros cívicos que cerraron; cafeterías y pisos nuevos.',
      exclusion: 'Subida de los alquileres y expulsión de vecinos (usar el subcódigo Gentrificación).',
      example: '«El bar de toda la vida cerró, el centro cívico ahora son pisos». (Luis)',
    },
    gentrification: {
      name: 'Gentrificación',
      description: 'Subida del coste de la vivienda, expulsión de vecinos y presión sobre el suelo, y cómo se sitúan los participantes ante ello.',
      inclusion: 'Alquileres, no poder permitirse seguir en el barrio, presión inmobiliaria sobre el terreno del huerto, culpa o resentimiento.',
      exclusion: 'Cambios sin coste ni expulsión de por medio (usar Cambio en el barrio).',
      example: '«Sé que la gente como yo somos parte del problema». (Javier)',
    },
    organisation: {
      name: 'Organización',
      description: 'Cómo se gestiona el huerto: normas, junta, voluntariado y apoyo externo.',
      inclusion: '', exclusion: '', example: '',
    },
    rules: {
      name: 'Normas y gobernanza',
      description: 'Normas escritas y no escritas, decisiones de la junta, revisiones y la forma de explicar las normas.',
      inclusion: 'Crear, hacer cumplir, saltarse o no entender normas; acuerdos alcanzados por la junta.',
      exclusion: 'La disputa que dio origen a una norma (usar Conflictos por las parcelas).',
      example: '«Las normas están bien mientras alguien las explique». (Pedro, grupo focal)',
    },
    waitingList: {
      name: 'Lista de espera',
      description: 'Esperar una parcela, y cómo se adjudican las plazas.',
      inclusion: 'Tiempo de espera, excepciones al orden de inscripción.',
      exclusion: '',
      example: '«Ahora hay una lista de espera que no se acaba nunca». (Carmen)',
    },
    municipal: {
      name: 'Apoyo municipal',
      description: 'Apoyo, o falta de él, del ayuntamiento y de otros servicios públicos (financiación, agua, terreno, derivaciones).',
      inclusion: 'Subvenciones, recortes, reparaciones, visitas de técnicos, derivaciones del centro de salud y prescripción social.',
      exclusion: 'El apoyo entre los propios hortelanos (usar Pertenencia).',
      example: '«Para mandar folletos son muy buenos, para mandar fontaneros no tanto». (Carmen)',
    },
    burden: {
      name: 'Carga del voluntariado',
      description: 'El peso de gestionar el huerto recae en unas pocas personas.',
      inclusion: 'Horas dedicadas, agotamiento, sentirse imprescindible, culpa de quienes hacen menos.',
      exclusion: 'El esfuerzo normal de cuidar la propia parcela (usar Actividad física).',
      example: '«Si mañana se fueran tres personas, no sé si el huerto sobreviviría». (Elena)',
    },
  },
  documents,
  memos: [
    {
      target: { kind: 'project' },
      title: 'Preguntas de investigación',
      body: [
        '## Preguntas de investigación',
        '',
        '1. ¿Cómo influyen los huertos comunitarios en el sentimiento de **pertenencia** de los participantes en barrios que cambian deprisa?',
        '2. ¿Qué beneficios para el **bienestar** describen los participantes, y quién parece beneficiarse más?',
        '3. ¿Cómo hace posible, o limita, esos beneficios la **organización** de los huertos (normas, voluntariado, apoyo del ayuntamiento)?',
        '',
        '## Material',
        '',
        '- Seis entrevistas semiestructuradas (dos codificadas también por Raúl, para el acuerdo entre codificadores)',
        '- Un grupo focal en el huerto de Ribera Nueva',
        '- Notas de campo de la jornada de puertas abiertas de Las Moreras',
        '- Cinco respuestas abiertas a una encuesta',
        '',
        'Todos los nombres son seudónimos. Los consentimientos informados se guardan aparte, no en este proyecto.',
      ].join('\n'),
    },
    {
      target: { kind: 'code', code: 'belonging' },
      title: 'Pertenencia sin preguntas',
      body:
        'Varios participantes describen la pertenencia como *que no les pregunten nada*: Amina («nadie necesita mis papeles»), Carmen («nadie dijo ni una palabra, me dejaron estar»), Luis («nadie me pidió que hablara de mis sentimientos»). Aquí la pertenencia se construye **trabajando codo con codo**, no conversando. Comprobar si se mantiene en las respuestas de la encuesta.',
    },
    {
      target: { kind: 'code', code: 'burden' },
      title: '¿Quién sostiene el huerto?',
      body:
        'Los mismos pocos nombres aparecen una y otra vez (Elena, Luis, las «mismas cinco personas» de R05). El bienestar que el huerto da a muchos parece descansar en el trabajo no remunerado de unos pocos, algunos de los cuales llegaron precisamente por su propio bienestar. Posible tema: **el coste del cuidado**. Comparar los relatos de quienes coordinan y de quienes solo tienen parcela.',
    },
    {
      target: { kind: 'document', doc: 'int3' },
      title: 'Entrevista 3: la mirada de la coordinación',
      body:
        'Elena es la única entrevistada que ve el huerto sobre todo desde dentro de su organización. Mucho de lo que los demás llaman «las normas» o «la junta» es, en su relato, una persona que contesta el teléfono a las diez y media de la noche. La excepción para quienes llegan derivados por el centro de salud es un buen ejemplo de cómo las normas llevan valores dentro («no somos solo un club de verduras»).',
    },
    {
      target: { kind: 'document', doc: 'focus' },
      title: 'Grupo focal: dinámica',
      body:
        'Pedro habla sobre todo del clima y de las normas; Rosa devuelve siempre la conversación a la comida y al dinero. La disputa por el agua fue claramente dolorosa para Rosa y el grupo cambió de tema enseguida. Jamal hace de puente entre hortelanos veteranos y nuevos, igual que Javier se describe a sí mismo en la entrevista 2.',
    },
    {
      target: { kind: 'case', case: 'p1' },
      title: 'Carmen',
      body:
        'Viuda desde hace cuatro años. El huerto aparece como lugar para vivir el duelo «sin que nadie montara un drama» y como estructura del día («un sitio adonde ir por la mañana»). Su relato de la bronca por la caseta vincula los conflictos por los espacios comunes con la memoria y la pérdida. Pendiente: ¿quiere participar en la jornada de puertas abiertas del año que viene?',
    },
    {
      target: { kind: 'coding', doc: 'int6', code: 'burden', quote: 'Casi me quemo. Lo cual tiene su ironía, teniendo en cuenta por qué vine.' },
      title: 'El huerto terapéutico que agota',
      body:
        'El propio Luis pone nombre a la paradoja: el lugar que le ayudó a recuperarse es ahora una fuente de desgaste. Buscar el mismo patrón en Elena (entrevista 3) y en R05. Podría convertirse en un argumento central sobre los límites de la prescripción social sin personal remunerado.',
    },
    {
      target: { kind: 'coding', doc: 'int5', code: 'belonging', quote: 'Aquí nadie necesita mis papeles. A las patatas les da igual de dónde soy.' },
      title: 'Pertenencia como alivio del escrutinio',
      body:
        'Amina contrapone el huerto a «los papeles, la oficina, el médico». La pertenencia se define frente al escrutinio institucional. ¿Es Pertenencia, o necesita un código propio sobre las instituciones? Comentarlo en la próxima reunión de codificación.',
    },
  ],
};
