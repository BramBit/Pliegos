# Etiquetado del conjunto de evaluación

`labels.json` asigna un grado de relevancia a cada oportunidad candidata de cada perfil de prueba.
Escala: **2** relevante, **1** parcial, **0** no relevante.

## Criterios

1. **Objeto primero.** Un 2 exige que el objeto principal del proceso esté cubierto por las capacidades o palabras clave del perfil.
2. **Escala del monto.** Si el monto supera 3 veces el máximo del perfil, o es muy inferior a su mínimo, el grado baja a 1. Un monto 0 o desconocido no se penaliza.
3. **La ubicación no entra en la etiqueta.** El departamento lo mide su propio factor del scoring.
4. **La etapa no cuenta.** Una solicitud de información cuyo objeto encaja puede ser 2.
5. **No recomendables = 0.** Contratación directa y régimen especial sin ofertas reciben 0 siempre, aunque el objeto encaje, porque el sistema no debe recomendarlas.
6. **Duda razonable = 1.** Si la descripción está vacía o es ambigua y el objeto podría encajar, se etiqueta 1.

## Estado actual

| Perfil | Grado 2 | Grado 1 | Grado 0 |
| --- | --- | --- | --- |
| golden-tech | 6 | 7 | 47 |
| golden-infra | 8 | 6 | 46 |
| golden-food | 0 | 1 | 59 |

## Limitación conocida

El primer conjunto de candidatos se armó con las 30 mejores según una versión anterior del scoring más 30 al azar, y no garantiza contener los procesos realmente relevantes. En `golden-food` no hay ningún grado 2, de modo que sus métricas no son interpretables hasta ampliar el conjunto con candidatos obtenidos por búsqueda de texto y vectorial.

## Casos dudosos (grado 1 por ambigüedad)

- `golden-tech`, "ADQUISICIÓN DE EQUIPOS DE COMUNICACIONES": sin descripción, podría ser redes o radios.
- `golden-tech`, "RENOVACIÓN DEL LICENCIAMIENTO PARA DARKTRACE": objeto de ciberseguridad, pero el monto es unas 7 veces el máximo del perfil.
