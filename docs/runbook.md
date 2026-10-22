# Pliegos — Runbook Operativo del Backend

Guía práctica para administración, mantenimiento de datos, reindexación y resolución de incidentes en el backend de Pliegos.

---

## 1. Mantenimiento y Calidad de Datos

### 1.1 Auditoría de Datos (`pnpm run audit:data`)
Script de solo lectura que examina la calidad de los registros en PostgreSQL:
```bash
pnpm run audit:data
```
Reporta:
- Totales por estado, modalidad de contratación y apertura de recepción.
- Distribución de códigos de categoría UNSPSC y verificación de placeholders eliminados.
- Modalidades con fechas de cierre nulas.
- Oportunidades sin departamento o ciudad.
- Oportunidades con cuantía cero o indeterminada.
- **Sección 9 — Cobertura de oportunidades recomendables**: porcentaje de procesos recomendables con embeddings generados, descripción, categoría UNSPSC válida, departamento canónico, cuantía conocida y fecha de cierre futura.

### 1.2 Backfill de Departamentos Canónicos (`pnpm run backfill:departments`)
Estandariza los nombres de departamentos al listado canónico de 33 entidades territoriales de Colombia (acentuación y mayúsculas normalizadas, Bogotá D.C., Archipiélago de San Andrés, etc.):
```bash
pnpm run backfill:departments
```
- Es completamente **idempotente**.
- Inicializa la columna `department_raw` preservando el valor textual original de SECOP II.
- Actualiza `department` con el nombre canónico oficial.
- Imprime el resumen por departamento y los valores no mapeados.

### 1.3 Resincronización de Procesos Unknown (`pnpm run resync:unknown`)
Reintenta la consulta contra SECOP II / Socrata API para aquellas oportunidades cuyo estado es `'Unknown'`:
```bash
pnpm run resync:unknown
```
- Procesa en lotes de 100 mediante `id_del_proceso IN (...)`.
- Conserva el identificador primario (`id` UUID) existente en la base de datos.
- Aplica las reglas actuales de mapeo de estados y almacena `source_status`.
- Imprime un histograma de los valores de `source_status` que aún persisten como Unknown.

---

## 2. Motor de Búsqueda Vectorial e Indexación

### 2.1 Reindexación Vectorial (`pnpm run reindex`)
Genera y actualiza los embeddings vectoriales de 768 dimensiones en `opportunity_embeddings` para las oportunidades recomendables:
```bash
# Reindexar todas las oportunidades recomendables pendientes
pnpm run reindex

# Reindexar con límite de registros (útil para pruebas o calibración)
pnpm run reindex --limit=100
```
- **Filtro de inclusión**: Aplica la regla de negocio `isRecommendable`: competitivas, en estado `Published` o `Amended`, y con fecha de cierre nula o superior a `now() - 7 días`.
- **Detección de cambios**: Computa el hash SHA-256 de `buildIndexText` y solo consulta a Ollama si el modelo o el texto cambiaron (`upToDateCount`).
- **Monitoreo de progreso**: Muestra en consola `"N pending of M recommendable"` al iniciar y tras cada lote procesado.
- **Refresco automático**: Al culminar, encola automáticamente el trabajo `refresh-recommendations` para todos los perfiles registrados en la plataforma.

---

## 3. Endpoints de Administración y Monitoreo

Todas las rutas bajo `/admin/*` requieren autenticación Bearer JWT con rol `admin`.

### 3.1 Historial de Ejecuciones (`GET /admin/pipeline`)
Retorna las últimas 20 ejecuciones de cron y tareas programadas registradas en `pipeline_runs`:
```http
GET /admin/pipeline
Authorization: Bearer <adminToken>
```
Tipos de corrida registrados:
- `sync`: Ingesta periódica de SECOP II.
- `analysis`: Procesamiento asíncrono de análisis y embeddings.
- `refresh`: Refresco de recomendaciones para perfiles.
- `deadlines`: Escaneo de plazos de cierre próximos.
- `alerts`: Envío de notificaciones y seguimiento de alertas.

### 3.2 Métricas de Inteligencia Artificial (`GET /admin/metrics`)
Reporte en memoria con contadores y percentiles de latencia de las llamadas a Ollama:
```http
GET /admin/metrics
Authorization: Bearer <adminToken>
```
Métricas provistas:
- Total de llamadas y fallos por modelo (`nomic-embed-text`, `llama3.1`) y funcionalidad (`embedding`, `summarization`).
- Tamaño promedio de entrada en caracteres.
- Latencias percentil 50 ($p_{50}$) y percentil 95 ($p_{95}$) sobre las últimas 100 llamadas.

### 3.3 Disparo Manual de Procesos Asíncronos
Responden inmediatamente `202 Accepted` retornando `{ "jobId": "<uuid>" }`:
- `POST /admin/sync`: Sincronización manual desde SECOP II (admite `{"since": "ISO-Date"}`).
- `POST /admin/alerts/run`: Revisión y despacho manual de alertas pendientes.
- `POST /admin/recommendations/refresh`: Recálculo forzado de recomendaciones para todos los perfiles.

El progreso y estado de cualquier tarea se consulta en:
```http
GET /admin/jobs/<jobId>
Authorization: Bearer <adminToken>
```

---

## 4. Diagnóstico de Salud y Modos Degradados

Pliegos provee dos sondas de salud públicas:
- `GET /health/live`: Verifica que el proceso de Node.js esté en ejecución. Retorna `200 { "status": "ok" }`.
- `GET /health/ready`: Evalúa la conectividad con dependencias críticas (`Postgres`, `Redis`, `Ollama` con timeout de 2 segundos).

### 4.1 Interpretación de Respuestas de Salud
| Estado HTTP | Payload `status` | Causa | Impacto en el Servicio |
|---|---|---|---|
| **200 OK** | `"ok"` | Base de datos, Redis y Ollama operativos. | Servicio al 100% de capacidades. |
| **200 OK** | `"degraded"` | Ollama no responde o superó timeout de 2s. | **Modo Degradado**: la API sigue activa para autenticación, gestión de perfiles, watchlist y alertas; las recomendaciones operan en modo fallback heurístico (filtros por fecha y cuantía sin ranking semántico). |
| **503 Service Unavailable** | `"error"` | Conexión a PostgreSQL fallida. | **Crítico**: La API no puede procesar solicitudes; el tráfico debe drenarse. |
| **503 Service Unavailable** | `"error"` | Conexión a Redis fallida. | **Crítico**: Las colas de BullMQ y el rate limiting no están disponibles. |

---

## 5. Gestión de Usuarios Administradores

Para crear el primer administrador en un entorno nuevo:
```bash
pnpm run admin:create admin@pliegos.co "ContraseñaSegura123!"
```
El script valida la fortaleza de la contraseña (mínimo 10 caracteres), genera el hash mediante `scrypt` con salt criptográfico y asigna el rol `admin`.
