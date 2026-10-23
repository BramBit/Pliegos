# Etiquetado del conjunto de evaluación

`labels.json` asigna un grado de relevancia a cada oportunidad candidata de cada perfil de prueba.
Escala: **2** relevante, **1** parcial, **0** no relevante.

## Criterios

1. **Objeto primero.** Un 2 exige que el objeto principal del proceso esté cubierto por las capacidades o palabras clave del perfil. Un objeto de un dominio cercano, pero que el perfil no presta, recibe 1.
2. **Escala del monto.** Si el monto supera 3 veces el máximo del perfil, o es inferior a un tercio de su mínimo, el grado máximo es 1. Un monto 0 o desconocido no se penaliza.
3. **La ubicación no entra en la etiqueta.** El departamento lo mide su propio factor del scoring.
4. **La etapa no cuenta.** Una solicitud de información cuyo objeto encaja puede ser 2.
5. **No recomendables = 0.** Contratación directa y régimen especial sin ofertas reciben 0 siempre. Los procesos de régimen especial "con ofertas" sí se evalúan por su objeto.
6. **Duda razonable = 1.** Si la descripción está vacía o es ambigua y el objeto podría encajar, se etiqueta 1.

Criterios por perfil:

- **Tecnología:** software a la medida, ciberseguridad e infraestructura y soporte de TI valen 2. Reventa de licencias genéricas y compra de equipos valen 1.
- **Infraestructura:** interventoría de obra y obras de infraestructura (vías, puentes, pavimento, redes, espacio público, escenarios) valen 2. Obras de edificaciones y mantenimiento locativo valen 1.
- **Alimentos:** operación y suministro de alimentación escolar valen 2. Menaje, bonos de alimentación, concesiones de cafetería e interventoría del programa valen 1.

## Estado actual

| Perfil | Etiquetas | Grado 2 | Grado 1 | Grado 0 |
| --- | --- | --- | --- | --- |
| golden-tech | 130 | 33 | 32 | 65 |
| golden-infra | 134 | 46 | 26 | 62 |
| golden-food | 129 | 14 | 14 | 101 |

## Cambio de perfil en alimentos

El perfil original de `golden-food` era una consultoría de inocuidad y calidad de alimentos. Entre las oportunidades recomendables solo había un caso claramente relevante (toma de muestras de agua y alimentos) y otro con monto fuera de escala (interventoría del programa de alimentación escolar). Con tan pocos positivos no se puede medir nada. El perfil se reemplazó por un operador de alimentación escolar e institucional, que es la actividad con más procesos en SECOP. La definición está en `golden-food.profile.json`. La etiqueta de grado 1 que tenía un proceso de laboratorio bajo el perfil anterior pasó a 0.

## Limitaciones conocidas

- Los candidatos salen de la búsqueda de texto y vectorial del propio sistema, así que las etiquetas miden sobre todo la calidad del orden y no si se escapan procesos relevantes. Conviene añadir de vez en cuando casos buscados a mano.
- Las etiquetas las asignó una sola persona. Los casos ambiguos están en grado 1 y son los más discutibles.
- Hay procesos duplicados (mismo título, monto y entidad con distinto identificador). Se etiquetaron igual entre sí.
