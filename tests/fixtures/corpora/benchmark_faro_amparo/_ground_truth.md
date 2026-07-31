# GROUND TRUTH — Benchmark "Proyecto Faro" (Amparo)
Juicio de Amparo Indirecto JF-QROO-AI-2026-00421
Corpus 100% ficticio (NYRAVA MÉXICO). Este documento es la verdad de fondo para pruebas de regresión.

## 1. Desenlace jurídico correcto esperado

El análisis constitucional del expediente debe concluir con los siguientes efectos en la sentencia:

1.  **Concesión del Amparo (IND-05 e IND-06)**: Procede la protección constitucional respecto al aseguramiento de los indicios obtenidos en Calle Nichupté 214. La orden de cateo CJ-214/2026 (doc. 06 penal / doc. 07 amparo) fue explícita en autorizar solo la oficina 402 y prohibir el ingreso a domicilios particulares. La ejecución en el domicilio del quejoso constituye una violación directa al art. 16, párrafo once, constitucional (inviolabilidad del domicilio).
2.  **Exclusión de Prueba Ilícita y Efecto Reflejo**: Deben declararse nulos los indicios IND-05 e IND-06. Por efecto reflejo, debe excluirse la conclusión tercera del dictamen documentoscópico DP-DOC-0189/2026 (doc. 09 amparo), ya que su análisis de autoría gráfica se basó exclusivamente en las fojas de la carpeta verde (IND-05) obtenida ilegalmente.
3.  **Negativa de Amparo (IND-01 e IND-03)**: No procede la exclusión de estos indicios en sede constitucional por el vicio de la cadena de custodia (discrepancia de hash). El Juez de Distrito (doc. 09) correctamente determina que es un tema de "legalidad" y "mismidad" cuya valoración corresponde al Juez de Control en la etapa intermedia; no constituye una violación directa a derechos fundamentales que amerite nulidad en amparo indirecto en esta fase.
4.  **Resolución sobre IND-02 (Celular)**: Se reconoce la violación al derecho a la privacidad por el intento de extracción sin orden específica, pero al no haberse obtenido información, el efecto se limita a prohibir accesos futuros sin control judicial.
5.  **Subsistencia del Caso Penal**: La concesión del amparo no implica la libertad del quejoso ni el sobreseimiento de la causa penal, ya que existen pruebas autónomas y lícitas (IND-01, IND-03, IND-04, testimoniales y documentos bancarios) que sostienen la vinculación a proceso.

## 2. Hallazgos esperados (motor de hallazgos)

- **H1. Exceso Territorial del Cateo**: La orden judicial (doc. 03 amparo) limitó el acto a un local comercial; el IPH y el inventario (docs. 02, 05 amparo) confiesan el ingreso a una casa habitación no autorizada.
- **H2. Imposibilidad Lógica Temporal (Hash)**: La bitácora BED-1120-2026 registra el inicio del proceso forense a las 06:58 hrs, mientras que el ingreso policial al inmueble fue entre 07:41 y 08:05 hrs. Es un hallazgo crítico de ruptura de secuencia lógica.
- **H3. Confesión de la Autoridad Ejecutora**: El policía Balam Tuz reconoce en su informe (doc. 05 amparo) que actuó por "instrucción de radio" fuera de la orden judicial, admitiendo la falta de fundamento legal para el ingreso al domicilio particular.
- **H4. Falta de Grabación de la "Urgencia"**: La autoridad no pudo presentar registro de la comunicación de radio que supuestamente ordenó el ingreso al domicilio, desvirtuando la excepción de urgencia.
- **H5. Recurso de Queja por Incumplimiento**: La defensa detectó un intento del MP de seguir analizando metadatos del indicio suspendido (doc. 14 amparo), lo que obligó a una rectificación ministerial.

## 3. Contradicciones plantadas (documento, tema, por qué es contradicción)

| # | Documentos en tensión | Tema | Por qué es contradicción |
|---|---|---|---|
| C1 | Doc. 03 (Orden de Cateo) vs. Doc. 02 (Demanda/Hechos) y Doc. 05 (Informes Previos) | Alcance material del cateo | La orden judicial prohíbe explícitamente entrar a casas habitación; las autoridades ejecutoras admiten haber entrado y recabado pruebas en la casa del quejoso. |
| C2 | Doc. 01/12 (Registro de Cadena RCC) vs. Doc. 01/13 (Bitácora Digital BED) | Hora de generación del hash | El laboratorio dice que empezó a las 06:58; el almacén dice que los recibió a las 14:20 y que antes de eso no se pudo procesar nada. |
| C3 | Doc. 05 (Informe Policía: ingreso 08:05) vs. Doc. 11 Matriz (CCTV: 07:41) | Hora de inicio de la diligencia | Discrepancia en la fidelidad del registro oficial frente a la evidencia tecnológica objetiva. |
| C4 | Doc. 05 (Informe MP: urgencia por riesgo) vs. Doc. 03 (Orden: exclusión expresa) | Justificación de la ilegalidad | El MP invoca una excepción (urgencia) que no está por encima de una prohibición judicial expresa y previa de la Jueza de Control. |

## 4. Evidencia faltante

- **Registro de Radio (Canal 4)**: No existe constancia de la orden que el policía dice haber recibido para ir al domicilio particular.
- **Ampliación Pericial Informática**: Ofrecida por la perito para explicar el desfase del reloj forense, pero nunca entregada al juzgado de distrito antes de la sentencia.
- **Acta de la Diligencia en Domicilio Particular**: No se levantó acta por separado del ingreso a Calle Nichupté, incorporándolo indebidamente al acta de la oficina.

## 5. Cronología esperada de hechos clave

| Fecha | Hecho | Fuente |
|---|---|---|
| 18/03/2026 | Se concede orden de cateo CJ-214/2026 (solo oficina 402) | Doc. 03 |
| 19/03/2026 06:58 | Registro de inicio de hash (anomalía temporal) | Doc. 01 |
| 19/03/2026 07:41 | Ingreso real al inmueble (CCTV) | Doc. 11 |
| 19/03/2026 11:47 | Ingreso ilegal al domicilio particular (Calle Nichupté) | Doc. 09 |
| 19/03/2026 14:20 | Ingreso de evidencia al almacén | Doc. 12 |
| 25/03/2026 | Presentación de demanda de amparo indirecto | Doc. 00/02 |
| 27/03/2026 | Se concede la suspensión definitiva | Doc. 06 |
| 10/04/2026 | Audiencia Constitucional | Doc. 08/13 |
| 22/04/2026 | Sentencia que concede amparo para exclusión de IND-05/06 | Doc. 09 |
| 28/04/2026 | Ministerio Público interpone Recurso de Revisión | Doc. 10 |

## 6. Credibilidad esperada de cada testigo (con justificación)

- **Policía Óscar Damián Balam Tuz — Credibilidad BAJA.** Sus informes contienen contradicciones horarias con el CCTV y admite haber violado los límites de la orden judicial basándose en una "orden de radio" que no puede probar.
- **Ing. Nadia Fernanda Escalante Ríos (Perito) — Credibilidad MEDIA.** Su trabajo técnico es detallado, pero la discrepancia de horarios de la bitácora bajo su control genera una duda razonable sobre la integridad de sus registros temporales.
- **José Armando Puc Lizama (Almacén) — Credibilidad ALTA.** Su informe es consistente con los libros de entrada y aporta claridad sobre la imposibilidad de que el hash se generara antes de las 14:20.

## 7. Salidas esperadas por motor

**Motor de Amparo**: Debe detectar que el acto reclamado es un exceso de ejecución y que la sentencia de amparo es la respuesta correcta para la exclusión de prueba ilícita.

**Motor de Contradicciones**: Debe priorizar el choque entre la Orden Judicial (limite territorial) y el Acta de Cateo (ejecución excedida).

## 8. Recomendaciones estratégicas

1.  **En el recurso de revisión**: Atacar la "fuente independiente" que alega la fiscalía, demostrando que sin la carpeta verde (IND-05) el dictamen documentoscópico pierde su conclusión principal de autoría.
2.  **En la causa penal**: Preparar el debate de la Etapa Intermedia sobre la cadena de custodia de IND-01/03, usando las pruebas del amparo (informe del almacén) para buscar su exclusión por falta de certeza.

## 9. Puntajes de riesgo (rango y justificación)

- **Autoridades Responsables: 90% (MUY ALTO)**. El revés constitucional es casi total respecto a los hallazgos en el domicilio particular. El riesgo de impunidad parcial es alto por la pérdida de la "carpeta verde".
- **Quejoso: 40% (MEDIO)**. Aunque ganó la exclusión de pruebas clave, el resto del material lícito (IND-01, 03, 04) sigue siendo suficiente para mantener el proceso penal vivo.
