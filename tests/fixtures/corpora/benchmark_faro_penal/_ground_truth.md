# GROUND TRUTH — Benchmark "Proyecto Faro" (Penal)
Carpeta de investigación CI-FGE-QR/BJ/UIDFD/1120/2026 | Carpeta judicial CJ-214/2026
Corpus 100% ficticio (NYRAVA MÉXICO). Este documento es la verdad de fondo para pruebas de regresión.

## 1. Desenlace jurídico correcto esperado

El corpus está diseñado para que un análisis jurídico riguroso concluya lo siguiente:

1. **Existencia del delito y probable responsabilidad**: los elementos lícitamente recabados en la oficina 402 (IND-01, IND-03, IND-04) más la entrevista de la víctima (doc. 04), el dictamen informático DP-INF-0442/2026 (doc. 12) y el dictamen documentoscópico DP-DOC-0189/2026 (doc. 13, conclusiones primera y segunda, referidas al sello 04-B y a la falsedad documental) **sí sostienen** una imputación por fraude genérico agravado (arts. 191 y 193-II CPQR) y uso de documento falso (art. 232 CPQR). El tipo de administración fraudulenta (art. 197) es más débil: no hay elementos periciales contables que acrediten manejo indebido de fondos societarios ajenos, salvo indicios (transferencia a "Servicios Integrales Nayán" referida por el testigo B, doc. 16) que requieren investigación complementaria.
2. **Exclusión probatoria parcial procedente**: los indicios IND-05 (carpeta verde) e IND-06 (memoria USB) fueron recabados en el domicilio particular de Calle Nichupté 214, expresamente excluido por la orden de cateo CJ-214/2026 (docs. 05 y 06). No hay flagrancia, consentimiento escrito ni autorización judicial complementaria (doc. 17, respuestas del policía; doc. 09, observaciones). Conforme al art. 264 CNPP y a la jurisprudencia sobre prueba ilícita citada en el amparo relacionado (docs. 11 y 21 del expediente de amparo), estos indicios y la conclusión tercera del dictamen DP-DOC-0189/2026 (autoría gráfica sobre fojas de IND-05) deben excluirse por efecto reflejo.
3. **La exclusión de IND-05/IND-06 no destruye el caso**: subsiste prueba de cargo autónoma y con fuente independiente respecto de IND-01, IND-03 e IND-04 (recabados lícitamente en la oficina 402), la documentación bancaria de la víctima y las declaraciones testimoniales. El desenlace esperado es una **vinculación a proceso sostenida** pero con **debate de exclusión probatoria parcial favorable a la defensa** respecto de IND-05/IND-06, sin que ello derive en sobreseimiento total.
4. **Cadena de custodia de IND-01 e IND-03 (discrepancia horaria del hash)**: es un vicio grave pero de naturaleza distinta —afecta el valor probatorio y la mismidad del indicio, no necesariamente su licitud de origen (la recolección sí fue en el lugar autorizado)— por lo que procede ampliación pericial y, de no aclararse, valoración negativa o exclusión por ruptura de cadena de custodia (arts. 227-228 CNPP), pero es "prematuro" resolverlo antes de la ampliación pericial ofrecida.
5. **IND-02 (celular)**: correctamente no se practicó extracción por falta de autorización judicial específica; cualquier intento futuro requiere nueva autorización judicial.
6. **Detención y prisión preventiva**: la orden de aprehensión (doc. 19) y la detención del 24/03/2026 son formalmente correctas (se ejecutó en cumplimiento de mandamiento judicial, independientemente del vicio del cateo previo), por lo que la libertad personal del imputado no debe verse afectada por la exclusión probatoria parcial.

## 2. Hallazgos esperados (motor de hallazgos)

- H1. Tres cifras distintas de hora de ingreso al inmueble: 07:20 (testigo A, doc. 15), 07:41:18 (CCTV/DP-VID-0077/2026, doc. 14) y 08:05 (acta de cateo doc. 07 e IPH doc. 08).
- H2. Discrepancia en el número de elementos policiales que ingresaron: "tres" según la testigo A (doc. 15) frente a "cinco" según el IPH (doc. 08), el testigo B (doc. 16), el propio policía (doc. 17) y el dictamen de videovigilancia (doc. 14, que documenta ocho personas en total incluyendo peritos y una novena a las 08:04:58).
- H3. La bitácora de evidencia digital BED-1120-2026 (doc. 11) registra inicio de adquisición forense de IND-01 e IND-03 a las 06:58 y 07:03 horas del 19/03/2026, es decir, **antes** de que el propio cateo hubiera concluido (12:36 hrs) y mucho antes de su ingreso al almacén (14:20/14:24 hrs, según RCC-1120-2026, doc. 10). Esta es una imposibilidad lógica/temporal expresamente reconocida por la perito (doc. 12, apartado V) y por el responsable del almacén.
- H4. IND-05 e IND-06 fueron recolectados en un domicilio (Calle Nichupté 214) distinto y no autorizado por la orden judicial CJ-214/2026, que expresamente excluyó cualquier domicilio particular (docs. 05, 06, 09 y 21).
- H5. Falta de acta separada y de identificación de la persona que atendió en el domicilio particular donde se recabaron IND-05/IND-06 (doc. 17, respuestas 2 y 3).
- H6. El dictamen documentoscópico (doc. 13) acredita que los documentos SEMA/DGIA/RES-0913/2024 y ZFMT/QR/0418/2023 son apócrifos (impresión láser vs. offset con tinta UV, tipografía distinta, ausencia de fibra de seguridad y microtexto, pixelación de escaneo de segunda generación) y que el sello 04-B (parte de IND-04, lícito) produjo las impresiones cuestionadas — corrobora el fraude documental con prueba lícita, independiente de IND-05.
- H7. El dictamen informático (doc. 12) acredita autoría de los archivos apócrifos por el usuario "aperaza" entre el 3 y el 29 de julio de 2025, con software de diseño gráfico (Adobe Illustrator) y no con sistemas institucionales, y su transmisión a la víctima el 6 de agosto de 2025 — prueba central de cargo, obtenida de IND-01/IND-03 (lícitos en origen, aunque con el vicio de cadena de custodia de H3).
- H8. Triangulación de fondos: de los $9,250,000.00 recibidos de la víctima, aproximadamente $6,800,000.00 se transfirieron a "Servicios Integrales Nayán, S.A. de C.V." sin entregables de la supuesta asesoría (doc. 16) — línea de investigación pendiente sobre administración fraudulenta y posible lavado de operaciones, no cerrada en el expediente.
- H9. El archivo "Notas_amarres.xlsx" (IND-06, dictamen informático doc. 12, hallazgo 4) documenta 11 contratantes por $23,480,000.00 M.N., cifra muy superior a los $9,250,000 imputados solo a Marina Puerto Azul — sugiere víctimas adicionales no incorporadas a esta carpeta, pero este archivo proviene de un indicio (IND-06) sujeto a exclusión probatoria.
- H10. El propio Ministerio Público reconoció en el índice (doc. 01, observaciones a y b) las dos irregularidades centrales (discrepancia horaria y objetos recabados fuera del domicilio autorizado) desde el 25 de marzo de 2026, antes de que la defensa promoviera exclusión — lo que descarta cualquier alegato de "descubrimiento tardío" por la defensa.

## 3. Contradicciones plantadas (documento, tema, por qué es contradicción)

| # | Documentos en tensión | Tema | Por qué es contradicción |
|---|---|---|---|
| C1 | Doc. 15 (testigo A, 07:20) vs. doc. 14 (CCTV, 07:41:18) vs. docs. 07/08 (acta e IPH, 08:05) | Hora de ingreso al inmueble | Tres fuentes independientes (testimonial, videográfica y documental oficial) reportan tres horas distintas de un mismo hecho puntual; el CCTV es la fuente más objetiva y contradice directamente el acta oficial y el IPH. |
| C2 | Doc. 15 (testigo A: "tres" policías al inicio) vs. doc. 08 (IPH: cinco elementos), doc. 16 (testigo B: "cinco... uniformados o con chaleco"), doc. 14 (CCTV: cinco identificables como policías, ocho personas en total) | Número de elementos actuantes | El acta oficial y dos fuentes independientes (testigo B y video) coinciden en cinco; solo la testigo A reporta un número menor, lo que puede deberse a percepción parcial pero genera duda sobre la fiabilidad de su registro temporal y numérico. |
| C3 | Doc. 11 (BED-1120-2026: adquisición forense de IND-01/IND-03 inicia 06:58/07:03 hrs) vs. doc. 10 (RCC-1120-2026: ingreso al almacén 14:20/14:24 hrs) | Momento de generación del hash/imagen forense | Es lógicamente imposible generar la imagen forense de un dispositivo antes de que exista constancia de su recolección y traslado; implica que uno de los dos registros es incorrecto, fue alterado, o hay un desfase de reloj de la estación forense no documentado — la propia perito (doc. 12) y el responsable de almacén (doc. 10) lo reconocen sin poder explicarlo. |
| C4 | Doc. 05/06 (orden de cateo: solo oficina 402, excluye expresamente domicilio particular) vs. doc. 09 (inventario: IND-05/06 recolectados en Calle Nichupté 214) | Ámbito territorial autorizado vs. ejecutado | La orden judicial es explícita y de interpretación estricta (doc. 06, considerando segundo); el inventario de evidencia documenta un acto de molestia en un domicilio no comprendido en el mandamiento, sin consentimiento ni autorización judicial adicional. |
| C5 | Doc. 17 (policía: "actué... en el entendido de que existía urgencia por riesgo de pérdida de evidencia... no solicité autorización judicial complementaria") vs. ausencia de cualquier registro de esa "urgencia" o de la instrucción por radio | Justificación de la diligencia irregular | El policía invoca una causa de urgencia no verificable (comunicación de radio no grabada, doc. 17 pregunta 1) que no cumple con los estándares de excepción al requisito de orden judicial (flagrancia, consentimiento, urgencia objetivamente verificable). |
| C6 | Doc. 16 (testigo B: "nunca vi el resolutivo... originales, el señor Peraza los manejaba directamente y solo circulaban en PDF") vs. doc. 04 (víctima: se le exhibieron documentos físicos en la reunión del 6 de agosto de 2025) vs. doc. 13 (dictamen: dos ejemplares impresos del resolutivo, IND-04) | Existencia de ejemplares físicos vs. solo digitales | La víctima afirma haber recibido/visto documentos físicos, existen ejemplares impresos periciados (IND-04), pero el contador asegura que solo circulaban en PDF — sugiere que el testigo B no tenía visibilidad completa de la operación documental, o que hay una fase de impresión posterior no declarada por él. |
| C7 | Doc. 15 (testigo A: "el licenciado Peraza llegó como a las ocho menos cuarto") vs. doc. 14 (CCTV no reporta expresamente el arribo de Peraza en el tramo analizado, aunque si el ingreso policial fue a las 07:41-07:44, "ocho menos cuarto" (07:45) sería consistente, pero contradice la hora de 08:05 del acta como hora de "inicio" del cateo) | Momento de llegada del imputado respecto del inicio real de la diligencia | Genera duda sobre si el imputado estuvo presente desde el inicio de la diligencia o llegó después, relevante para su derecho de contradicción en el desarrollo del cateo. |
| C8 | Doc. 15 (testigo A, recepcionista, dependiente laboral directa del imputado) vs. doc. 16 (testigo B, contador externo con conflicto documentado con el imputado desde diciembre de 2025 por negarse a "rehacer" CFDI) | Posible sesgo de los testigos | Ambos testigos tienen vínculos con el imputado que deben ponderarse: la testigo A depende laboralmente de él (riesgo de lealtad o de temor, ella misma solicita medidas de protección por temor a represalias laborales); el testigo B tuvo un conflicto expreso con el imputado (riesgo de resentimiento), lo que no invalida sus dichos pero exige valorarlos con cautela y en conjunto con prueba documental/pericial independiente. |

## 4. Evidencia faltante

- Grabación o bitácora de la comunicación por "radio, canal operativo 4" que habría ordenado el ingreso al domicilio particular (doc. 17): no existe, lo que impide verificar la supuesta urgencia.
- Ampliación pericial informática sobre la discrepancia horaria de BED-1120-2026 vs. RCC-1120-2026 (ofrecida como pendiente en el propio dictamen, doc. 12, conclusión quinta, y reiterada en el amparo, doc. 07 del expediente de amparo): no rendida a la fecha de corte de la carpeta.
- Acta separada de la diligencia practicada en Calle Nichupté 214 (doc. 17, respuesta 2: "no, los objetos se incorporaron al inventario de la diligencia principal") — ausencia que impide reconstruir con precisión hora exacta, testigos de asistencia e identidad de quien atendió.
- Identidad de la persona que atendió al Policía Zetina Loría en el domicilio particular (doc. 17, respuesta 3: "no asentó dato alguno").
- Dictamen contable/financiero formal sobre el destino de los ~$6,800,000.00 transferidos a "Servicios Integrales Nayán, S.A. de C.V." (solo referido por el testigo B, doc. 16, sin pericial contable que lo verifique).
- Investigación sobre los "al menos dos compradores individuales" mencionados en la denuncia anónima (doc. 02) y sobre los 11 contratantes por $23,480,000.00 del archivo "Notas_amarres.xlsx" (doc. 12) — no hay diligencias dirigidas a identificar o entrevistar a esas personas.
- Entrevista o declaración de Bernardo Kuri Elías, administrador único de Faro Náutico del Caribe (mencionado solo tangencialmente por el testigo B, doc. 16) — no aparece entrevistado ni investigado su posible responsabilidad u omisión de vigilancia.
- Registro fotográfico o pericial que corrobore o descarte objetivamente la hora de apertura de la oficina reportada por la testigo A (07:20) frente al CCTV.
- Dictamen o constancia sobre el "desfase del reloj de la estación FRED-QR-03" ofrecido como hipótesis explicativa de la discrepancia horaria (mencionado en el expediente de amparo, doc. 07, pero no resuelto).

## 5. Cronología esperada de hechos clave

| Fecha/Hora | Hecho | Fuente |
|---|---|---|
| Ago–dic 2025 | Elaboración y uso de documentos apócrifos (resolutivo y concesión) atribuidos al usuario "aperaza"; tres transferencias de la víctima por $9,250,000.00 | Docs. 04, 12, 16 |
| 12/03/2026 21:14 | Denuncia anónima línea 089 | Doc. 02 |
| 15/03/2026 10:30 | Acuerdo de inicio de carpeta de investigación | Doc. 03 |
| 15/03/2026 13:40 | Entrevista a la representante de la víctima | Doc. 04 |
| 16-17/03/2026 | Vigilancia discreta del inmueble; oficio SEMA que niega el resolutivo | Docs. 17, 20 |
| 18/03/2026 09:12 | Solicitud de orden de cateo (solo oficina 402) | Doc. 05 |
| 18/03/2026 17:45 | Orden judicial de cateo concedida, excluyendo expresamente domicilio particular | Doc. 06 |
| 19/03/2026 06:58 y 07:03 | Inicio de adquisición forense de IND-01/IND-03 según BED-1120-2026 (¡antes del cateo!) | Doc. 11 (contradicción C3) |
| 19/03/2026 07:20 / 07:41 / 08:05 | Tres versiones de la hora de ingreso al inmueble | Docs. 15, 14, 07/08 (contradicción C1) |
| 19/03/2026 09:12-10:07 | Recolección de IND-01 a IND-04 en oficina 402 (lícita) | Doc. 09 |
| 19/03/2026 11:47-11:52 | Recolección de IND-05 e IND-06 en domicilio particular (no autorizada) | Doc. 09 (contradicción C4) |
| 19/03/2026 12:36 | Conclusión del cateo | Doc. 07 |
| 19/03/2026 14:20 y 14:24 | Ingreso de IND-01/IND-03 al almacén y generación de imagen forense según RCC-1120-2026 | Doc. 10 |
| 20/03/2026 09:05 | Entrega a laboratorio; se suspende extracción de IND-02 por falta de autorización | Doc. 10, 11 |
| 21/03/2026 | Dictamen pericial informático DP-INF-0442/2026 | Doc. 12 |
| 22/03/2026 | Declaraciones de testigos A y B | Docs. 15, 16 |
| 23/03/2026 | Dictámenes documentoscópico y de videovigilancia; declaración del policía; orden de aprehensión (19:30 hrs) | Docs. 13, 14, 17, 19 |
| 24/03/2026 07:35 | Detención del imputado en su domicilio particular | Doc. 19 |
| 24/03/2026 17:00 | Audiencia inicial; prisión preventiva justificada; duplicidad de plazo | Doc. 19 |
| 25/03/2026 | Demanda de amparo indirecto (expediente relacionado) | Doc. 20 |
| 27/03/2026 | Auto de vinculación a proceso (plazo de investigación complementaria de tres meses) | Doc. 20 |
| 20/04/2026 | Escrito de defensa de exclusión de medios de prueba | Doc. 21 |

## 6. Credibilidad esperada de cada testigo (con justificación)

- **Claudia Rebeca Fonseca Iriarte (víctima/apoderada, doc. 04) — Credibilidad ALTA.** Declaración detallada, con fechas y montos precisos, corroborada documentalmente (contrato, transferencias bancarias, correos electrónicos) y con el dictamen informático (correos del 6/08/2025 con los archivos apócrifos adjuntos). Interés personal en el resultado del proceso (calidad de víctima/coadyuvante) que debe ponderarse, pero su dicho está fuertemente corroborado por prueba independiente.
- **Lorena Massiel Uc Chi (Testigo A, recepcionista, doc. 15) — Credibilidad MEDIA.** Aporta datos relevantes sobre instrucciones del imputado ("imprimir en el papel bueno", "rehacer facturas") que son consistentes con el resto del expediente, pero su cronometraje de los hechos del 19/03/2026 (hora de apertura 07:20, "tres" policías) es contradicho por el CCTV, el IPH y el testigo B. Su dependencia laboral directa del imputado y su declarado temor a represalias laborales son factores que exigen cautela adicional, aunque no invalidan su testimonio sustantivo sobre los hechos previos al cateo.
- **Gerardo Antonio Ruvalcaba Núñez (Testigo B, contador externo, doc. 16) — Credibilidad ALTA-MEDIA.** Su declaración está sustentada con documentos que aporta (correo de negativa a reexpedir CFDI, estado de cuenta, relación de transferencias), y su versión del número de policías (cinco) es congruente con el IPH y el CCTV. Su afirmación de que "nunca vio el resolutivo... original" es la única fisura relevante (contradicción C6), explicable por no ser el responsable directo de esa documentación. Tuvo un conflicto documentado con el imputado (negativa a refacturar), lo que podría sugerir motivo de resentimiento, pero su versión es la más corroborada objetivamente del expediente.
- **Policía Tercero Óscar Damián Balam Tuz (doc. 17) — Credibilidad BAJA-MEDIA en lo relativo a la diligencia en el domicilio particular; MEDIA-ALTA en el resto.** Reconoce expresamente que actuó fuera del ámbito autorizado sin sustento verificable (comunicación de radio no grabada), lo cual es una admisión relevante en su contra procesal. Su reporte de horarios (08:05 de ingreso) es contradicho por el CCTV (fuente objetiva), lo que resta fiabilidad a su narrativa cronológica, aunque no hay indicios de mala fe, sino de imprecisión o de un intento de uniformar el registro oficial.
- **Andrés Iván Peraza Manzanilla (imputado) — No rindió declaración** (se reservó su derecho, doc. 08); no aporta versión de los hechos para contrastar en esta etapa.

## 7. Salidas esperadas por motor

**Motor de contradicciones**: debe listar como mínimo C1 a C8 de la sección 3, priorizando C3 (imposibilidad lógica de la cadena de custodia) y C4 (exceso territorial del cateo) como las de mayor impacto procesal, y C1/C2 (horas y número de policías) como relevantes para la fiabilidad global de la diligencia.

**Motor de cronología**: debe reconstruir la línea de tiempo de la sección 5, señalando expresamente la anomalía temporal del hash (06:58/07:03 antes de la recolección 09:12/09:41 y antes del ingreso al almacén 14:20/14:24) como un evento que rompe la secuencia lógica esperada.

**Motor de testigos**: debe generar los perfiles de credibilidad de la sección 6, identificando expresamente los vínculos de dependencia/conflicto de cada testigo con el imputado y contrastando sus dichos con el CCTV (fuente más objetiva disponible).

**Motor de vacíos probatorios**: debe señalar como mínimo los ocho puntos de la sección 4, priorizando la falta de acta separada de la diligencia en Nichupté 214 y la ausencia de ampliación pericial sobre la discrepancia horaria.

**Motor de estrategia**: debe identificar como estrategia de defensa viable y razonable la exclusión probatoria de IND-05/IND-06 y de la conclusión tercera del dictamen documentoscópico por efecto reflejo (art. 264 CNPP), y como estrategia del Ministerio Público la defensa de "fuente independiente" respecto de IND-01/IND-03/IND-04, reconociendo el riesgo de exclusión también de estos si no se resuelve satisfactoriamente la discrepancia horaria de cadena de custodia.

**Motor de informes**: el informe ejecutivo debe reflejar el desenlace de la sección 1 (vinculación a proceso sostenida con exclusión parcial probable de IND-05/IND-06), advertir el riesgo pendiente sobre IND-01/IND-03 por la discrepancia de cadena de custodia, y recomendar las líneas de investigación pendientes de la sección 4.

## 8. Recomendaciones estratégicas

Para la defensa:
1. Insistir en la exclusión de IND-05 e IND-06 y del efecto reflejo sobre la conclusión tercera del dictamen documentoscópico (ya planteado en doc. 21); es la línea con mayor probabilidad de éxito dado que la propia autoridad reconoce el exceso.
2. Explotar la discrepancia de cadena de custodia de IND-01/IND-03 (C3) para cuestionar la integridad/mismidad de la prueba pericial informática central, exigiendo la ampliación pericial pendiente y, de no aclararse satisfactoriamente, solicitar su exclusión también por ruptura de cadena de custodia.
3. Utilizar las contradicciones C1 y C2 (horas y número de elementos) para cuestionar la fiabilidad general del acta de cateo y del IPH como documentos oficiales, apoyándose en el dictamen de videovigilancia como prueba objetiva independiente.
4. Cuestionar la calidad de los testigos A y B por sus vínculos de dependencia/conflicto con el imputado, sin descartar que ello ayude más a matizar el peso que a excluirlos.

Para el Ministerio Público:
1. Obtener y aportar de inmediato la ampliación pericial sobre la discrepancia horaria de BED-1120-2026 (pendiente desde el 28 de marzo de 2026 según el expediente de amparo), pues su ausencia es explotable por la defensa y compromete la prueba central del caso.
2. Reforzar la teoría de "fuente independiente" respecto de IND-03 (14 versiones intermedias también documentadas) para sostener el fraude documental sin depender de IND-05.
3. Abrir línea de investigación complementaria sobre "Servicios Integrales Nayán, S.A. de C.V." y sobre los compradores/contratantes adicionales referidos en la denuncia anónima y en el archivo "Notas_amarres.xlsx", dentro del plazo de investigación complementaria de tres meses.
4. Investigar la posible responsabilidad del administrador único Bernardo Kuri Elías y valorar reformular o ampliar la imputación por administración fraudulenta con soporte pericial contable.

## 9. Puntajes de riesgo esperados (rango y justificación)

- **Riesgo procesal global del caso para la Fiscalía: 55-65/100 (riesgo medio-alto).** Justificación: existe prueba de cargo sólida e independiente (dictámenes documentoscópico e informático sobre IND-01/03/04, testimoniales corroboradas, documentación bancaria de la víctima) que sostiene la imputación por fraude y uso de documento falso; sin embargo, el exceso territorial del cateo (IND-05/06) y, sobre todo, la imposibilidad lógica de la cadena de custodia de IND-01/IND-03 (C3) representan un riesgo real de exclusión probatoria parcial adicional si no se aclara mediante ampliación pericial, lo que podría debilitar significativamente la prueba pericial informática, columna vertebral del caso.
- **Riesgo de exclusión de IND-05/IND-06: 85-95/100 (muy alto, prácticamente cierto).** Justificación: la propia autoridad (MP y policía) reconoce expresamente el exceso, no hay excepción constitucional aplicable acreditada (no hay flagrancia, consentimiento ni autorización judicial), y existe jurisprudencia y doctrina claramente aplicable (interpretación estricta de la orden de cateo, art. 16 CPEUM).
- **Riesgo de exclusión adicional de IND-01/IND-03 por cadena de custodia: 30-45/100 (riesgo moderado, condicional).** Justificación: depende de si la ampliación pericial explica razonablemente el desfase (p. ej., desfase de reloj de estación forense); si no se aclara, el riesgo de exclusión o de valoración probatoria muy disminuida se eleva sustancialmente (podría subir a 60-70/100).
- **Riesgo reputacional/institucional para la Fiscalía por inconsistencias documentales (horas, número de policías): 20-30/100 (bajo-moderado).** Justificación: son inconsistencias que afectan la credibilidad del acta e IPH pero no son, por sí solas, causa de nulidad de la diligencia principal realizada dentro del ámbito autorizado.
