# Pliegos — Inteligencia de Contratación Pública

> Plataforma de inteligencia para contratación pública estatal en Colombia (SECOP II). Pliegos no es simplemente un buscador de licitaciones: actúa como un analista digital que descubre, filtra, prioriza con explicaciones transparentes y monitorea oportunidades de negocio para contratistas y oferentes.

---

## 🏛 Arquitectura del Sistema

El proyecto está diseñado bajo **Arquitectura Hexagonal (Puertos y Adaptadores)** y principios **SOLID**, garantizando que el núcleo del dominio y la lógica de negocio permanezcan completamente desacoplados de frameworks, bases de datos o servicios externos.

```
                    ┌────────────────────────────────────────────────────────┐
                    │                    DRIVING ADAPTERS                    │
                    │  ┌─────────────────────────┐  ┌─────────────────────┐  │
                    │  │   REST API Controllers  │  │  Scheduler Adapter  │  │
                    │  │  (NestJS + Swagger UI)  │  │  (@nestjs/schedule) │  │
                    │  └────────────┬────────────┘  └──────────┬──────────┘  │
                    └───────────────┼──────────────────────────┼─────────────┘
                                    │ (Input Ports)            │
                                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ APPLICATION LAYER (Use Cases returning Result<T, E>)                                        │
│  • SyncOpportunitiesUseCase       • SearchOpportunitiesUseCase   • ConfigureProfileUseCase  │
│  • GetRecommendationsUseCase      • RegisterFeedbackUseCase      • ReviewFollowUpUseCase    │
└──────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN LAYER (Zero external dependencies)                                                   │
│  • Entities: Opportunity, Profile, Recommendation, Alert                                    │
│  • Value Objects: Money (COP), RelevanceScore [0..1], AmountRange, Typed IDs               │
│  • Domain Services: MatchingService (Weighted scoring: UNSPSC + Semantic + Amount + Location)│
└──────────────────────────────────────────▲──────────────────────────────────────────────────┘
                                           │
                                           │ (Output Ports)
                    ┌──────────────────────┴─────────────────────────────────┐
                    │                    DRIVEN ADAPTERS                     │
                    │  ┌─────────────────────────┐  ┌─────────────────────┐  │
                    │  │  PostgreSQL Repositories│  │    SecopAdapter     │  │
                    │  │   (Native pg + SQL)     │  │  (Socrata Open Data)│  │
                    │  ├─────────────────────────┤  ├─────────────────────┤  │
                    │  │    PgVectorAdapter      │  │    OllamaAdapter    │  │
                    │  │   (768-dim Embeddings)  │  │  (Local AI: nomic)  │  │
                    │  ├─────────────────────────┤  ├─────────────────────┤  │
                    │  │   BullMQ Queue Adapter  │  │    EmailAdapter     │  │
                    │  │  (Async Analysis Job)   │  │(Notification Channel)│ │
                    │  └─────────────────────────┘  └─────────────────────┘  │
                    └────────────────────────────────────────────────────────┘
```

### Principios Fundamentales
- **Sin ORM:** Acceso a PostgreSQL mediante el driver nativo `pg` y sentencias SQL directas, garantizando control sobre consultas y rendimiento vectorial.
- **Railway Oriented Programming (`Result<T, E>`):** Manejo explícito y tipado de errores de negocio sin excepciones descontroladas (`throw` reservado exclusivamente para fallos de infraestructura no recuperables).
- **Inversión de Dependencias:** La capa de aplicación y dominio define interfaces TypeScript (puertos); la infraestructura implementa adaptadores inyectados vía tokens de NestJS.
- **Explicabilidad (No Black Box):** Cada recomendación entrega los factores específicos que la motivaron (*"Coincide con tu categoría de interés"*, *"Monto dentro de tu rango declarado"*, etc.).

---

## 🚀 Alcance Implementado en Fase 1 (MVP)

1. **Módulo de Oportunidades (`OpportunityModule`)**:
   - Ingesta y normalización de procesos públicos de SECOP II vía Socrata API (`SecopAdapter`).
   - Detección automática de adendas, cambios de estado y registro histórico de variaciones.
   - Búsqueda híbrida (`PgVectorAdapter`): Búsqueda semántica vectorial por distancia coseno (768 dimensiones) combinada con filtros estructurados (categoría UNSPSC, departamento, cuantía).
   - Cola asíncrona de análisis (`AnalyzeOpportunityJob` con BullMQ y Redis) para generación de embeddings y resúmenes analíticos bajo demanda sin bloquear la ingesta. Pliego document extraction is out of scope for this stage.

2. **Módulo de Perfiles de Contratista (`ProfileModule`)**:
   - Modelado de capacidades técnicas, años de experiencia y preferencias de contratación (códigos UNSPSC, palabras clave, rango de cuantía en COP y departamentos de interés).

3. **Módulo de Recomendaciones (`RecommendationModule`)**:
   - Motor de afinidad ponderada (`MatchingService`):
     $$\text{Score} = 0.35 \times \text{category} + 0.35 \times \text{semantic} + 0.20 \times \text{amount} + 0.10 \times \text{location}$$
   - Explicaciones estructuradas y registro de retroalimentación (`Participate` / `Discard`) para calibración continua.
   - Adaptador local de Inteligencia Artificial (`OllamaAdapter`) con cero costos de API (modelo de embeddings `nomic-embed-text` y modelo conversacional `llama3.1`).

4. **Módulo de Alertas (`AlertModule`)**:
   - Identificación de alertas no entregadas ante adendas, cambios de estado y fechas de cierre próximas.
   - Despacho de notificaciones por correo electrónico (`EmailAdapter`).

5. **Módulo de Automatización / Scheduler (`SchedulerModule`)**:
   - Driving adapter cron (`@nestjs/schedule`) configurado para:
     - Sincronización periódica de SECOP II: **Cada 4 horas** (`0 0-23/4 * * *`).
     - Revisión diaria de alertas y seguimiento: **Diario a las 8:00 AM** (`0 08 * * *`).

6. **Documentación Interactiva de API**:
   - Interfaz interactiva moderna montada con **Scalar** en `/reference`.
   - Especificación OpenAPI 3.0 cruda disponible en `/api-json`.

---

## 🛠 Stack Tecnológico

| Componente | Tecnología | Versión |
|---|---|---|
| **Runtime** | Node.js (Active LTS) | **24.x** |
| **Gestor de Paquetes** | pnpm | **12.x** |
| **Lenguaje** | TypeScript | **5.9.x** (Strict Mode) |
| **Framework Backend** | NestJS | **12.1.x** |
| **Base de Datos** | PostgreSQL + pgvector (768 dims) | **16.x** |
| **Driver BD** | `pg` nativo (Sin ORM) | **8.23.x** |
| **Cola de Tareas** | BullMQ + Redis | **6.3.x** / **7-alpine** |
| **IA Local** | Ollama (`nomic-embed-text`, `llama3.1`) | Local |
| **Documentación** | `@nestjs/swagger` + `@scalar/nestjs-api-reference` | **12.0.x** / **1.2.x** |
| **Testing** | Jest + ts-jest | **30.5.x** / **29.4.x** |

---

## 💻 Puesta en Marcha Local

### 1. Prerrequisitos
- Node.js 24.x LTS y `pnpm` instalados.
- Docker y Docker Compose instalados.
- [Ollama](https://ollama.com/) instalado y corriendo en tu máquina con los modelos necesarios:
  ```bash
  ollama pull nomic-embed-text
  ollama pull llama3.1
  ```

### 2. Configurar Variables de Entorno
Copia la plantilla de variables de entorno:
```bash
cp .env.example .env
```
Ajusta los valores si necesitas cambiar puertos o credenciales locales.

### 3. Levantar Servicios con Docker Compose
Inicia toda la infraestructura local con un solo comando:
```bash
docker compose up -d
```
Esto levanta:
- `pliegos-postgres`: PostgreSQL 16 con extensión `pgvector` (puerto `5433:5432`).
- `pliegos-redis`: Redis 7 para colas asíncronas BullMQ y rate limiting (puerto `6379`).
- `pliegos-mailpit`: Servidor SMTP de desarrollo y bandeja web (SMTP `1025`, Web UI `8025`).
- `pliegos-api`: Servicio HTTP API de Pliegos (`ROLE=api`, puerto `3000`).
- `pliegos-worker`: Trabajador en segundo plano para cron jobs y colas BullMQ (`ROLE=worker`).

Verifica que los contenedores estén saludables:
```bash
docker compose ps
```

### 4. Instalar Dependencias
```bash
pnpm install
```

### 5. Inicializar el Esquema de Base de Datos
Aplica las migraciones SQL versionadas de `migrations/` (extensión `vector`, tablas, índices y restricciones). Es idempotente: solo ejecuta las que faltan.
```bash
pnpm run db:migrate
```

### 6. Iniciar la Aplicación (Localmente fuera de Docker)

**Modo Desarrollo (con recarga automática):**
```bash
pnpm run start:dev
```

**Modo Producción Separado:**
```bash
pnpm run build

# Terminal 1: Proceso API HTTP
pnpm run start:api

# Terminal 2: Proceso Worker en segundo plano
pnpm run start:worker
```

La consola confirmará el inicio del servicio:
```text
[Bootstrap] Pliegos API running on http://localhost:3000
[Bootstrap] Scalar API Reference available at http://localhost:3000/reference
[Bootstrap] OpenAPI JSON available at http://localhost:3000/api-json
```

---

## 📖 Superficie de la API REST

La especificación completa OpenAPI 3.0 se encuentra en [`docs/openapi.json`](docs/openapi.json). La documentación interactiva de Scalar está disponible en vivo en:
👉 **[http://localhost:3000/reference](http://localhost:3000/reference)**

| Método | Ruta | Autenticación | Rol | Descripción |
|---|---|---|---|---|
| `GET` | `/health/live` | Pública | — | Sonda de vida del proceso Node.js |
| `GET` | `/health/ready` | Pública | — | Sonda de disponibilidad (PostgreSQL, Redis, Ollama) |
| `GET` | `/reference` | Pública | — | Interfaz interactiva Scalar |
| `GET` | `/api-json` | Pública | — | Especificación OpenAPI 3.0 cruda |
| `POST` | `/auth/register` | Pública | — | Registro de nuevo usuario (mínimo 10 caracteres) |
| `POST` | `/auth/login` | Pública | — | Inicio de sesión (retorna accessToken 15m y refreshToken 7d) |
| `POST` | `/auth/refresh` | Pública | — | Rotación de token con revocación del token previo |
| `POST` | `/auth/logout` | Pública | — | Revocación de refresh token |
| `GET` | `/auth/me` | Bearer JWT | `user`, `admin` | Datos del usuario actualmente autenticado |
| `GET` | `/opportunities` | Bearer JWT | `user`, `admin` | Búsqueda híbrida (vectorial + filtros) y listado paginado |
| `GET` | `/opportunities/{id}` | Bearer JWT | `user`, `admin` | Detalle de proceso con generación perezosa de resumen IA |
| `POST` | `/profiles` | Bearer JWT | `user`, `admin` | Creación de perfil de contratista (HTTP 201) |
| `GET` | `/profiles` | Bearer JWT | `user`, `admin` | Lista paginada de perfiles del usuario (`Page<ProfileDto>`) |
| `GET` | `/profiles/{id}` | Bearer JWT | `user`, `admin` | Detalle de un perfil específico |
| `PUT` | `/profiles/{id}` | Bearer JWT | `user`, `admin` | Actualización completa de un perfil existente |
| `DELETE` | `/profiles/{id}` | Bearer JWT | `user`, `admin` | Eliminación de perfil (cascada sobre recomendaciones y alertas) |
| `GET` | `/profiles/{id}/recommendations` | Bearer JWT | `user`, `admin` | Feed paginado de recomendaciones con desglose de afinidad |
| `GET` | `/profiles/{id}/summary` | Bearer JWT | `user`, `admin` | Contadores de dashboard (nuevas, vigiladas, por cerrar, alertas) |
| `GET` | `/profiles/{id}/watches` | Bearer JWT | `user`, `admin` | Lista paginada de procesos vigilados con historial de cambios |
| `POST` | `/profiles/{id}/watches/{opportunityId}` | Bearer JWT | `user`, `admin` | Agregar proceso a la lista de vigilancia |
| `DELETE` | `/profiles/{id}/watches/{opportunityId}` | Bearer JWT | `user`, `admin` | Remover proceso de la lista de vigilancia |
| `GET` | `/profiles/{id}/alerts` | Bearer JWT | `user`, `admin` | Bandeja de entrada de alertas de un perfil |
| `POST` | `/profiles/{id}/alerts/read-all` | Bearer JWT | `user`, `admin` | Marcar todas las alertas del perfil como leídas |
| `POST` | `/recommendations/{id}/feedback` | Bearer JWT | `user`, `admin` | Registrar feedback (`Participate`/`Discard`) con sincronización atómica de vigilancia |
| `DELETE` | `/recommendations/{id}/feedback` | Bearer JWT | `user`, `admin` | Deshacer feedback de recomendación |
| `POST` | `/alerts/{id}/read` | Bearer JWT | `user`, `admin` | Marcar una alerta individual como leída |
| `POST` | `/admin/sync` | Bearer JWT | `admin` | Encolar sincronización SECOP II (HTTP 202 `{ jobId }`) |
| `POST` | `/admin/alerts/run` | Bearer JWT | `admin` | Encolar revisión de alertas (HTTP 202 `{ jobId }`) |
| `POST` | `/admin/recommendations/refresh` | Bearer JWT | `admin` | Encolar refresco de recomendaciones para todos los perfiles |
| `GET` | `/admin/jobs/{id}` | Bearer JWT | `admin` | Consultar estado de trabajo BullMQ por UUID |
| `GET` | `/admin/metrics` | Bearer JWT | `admin` | Reporte en memoria de métricas de IA (latencias $p_{50}$ y $p_{95}$) |
| `GET` | `/admin/pipeline` | Bearer JWT | `admin` | Historial de las últimas 20 ejecuciones de pipeline y cron |

---

## ⚙️ Variables de Entorno

Validadas estrictamente con Zod al arranque en `src/config/env.ts`:

| Variable | Tipo | Default | Descripción |
|---|---|---|---|
| `NODE_ENV` | `development \| test \| production` | `development` | Entorno de ejecución |
| `ROLE` | `api \| worker \| all` | `all` | Rol del proceso (`api`, `worker` o monolítico `all`) |
| `PORT` | Entero (1..65535) | `3000` | Puerto HTTP del servidor API |
| `LOG_LEVEL` | `debug \| info \| warn \| error` | `info` | Nivel mínimo de logs estructurados |
| `DATABASE_URL` | PostgreSQL URL | *Requerido* | Conexión a base de datos PostgreSQL |
| `TEST_DATABASE_URL` | PostgreSQL URL | *Opcional* | Conexión para base de datos de tests Jest |
| `REDIS_HOST` | String | *Requerido* | Host de Redis |
| `REDIS_PORT` | Entero (1..65535) | *Requerido* | Puerto de Redis |
| `OLLAMA_BASE_URL` | HTTP URL | *Requerido* | URL base de Ollama (`http://localhost:11434`) |
| `OLLAMA_EMBED_MODEL` | String | *Requerido* | Modelo de embeddings (`nomic-embed-text`) |
| `OLLAMA_CHAT_MODEL` | String | *Requerido* | Modelo LLM (`llama3.1`) |
| `OLLAMA_EMBED_TIMEOUT_MS` | Entero positivo | `30000` | Timeout llamadas embeddings (ms) |
| `OLLAMA_CHAT_TIMEOUT_MS` | Entero positivo | `120000` | Timeout llamadas chat/resumen (ms) |
| `SYNC_OPPORTUNITIES_CRON` | Cron string | `0 0-23/4 * * *` | Frecuencia de sincronización SECOP II |
| `REVIEW_FOLLOW_UP_CRON` | Cron string | `0 08 * * *` | Frecuencia de revisión y envío de alertas |
| `SCAN_DEADLINES_CRON` | Cron string | `30 07 * * *` | Frecuencia de escaneo de plazos próximos |
| `SECOP_APP_TOKEN` | String | *Opcional* | Socrata App Token para SECOP II |
| `SECOP_PAGE_SIZE` | Entero positivo | `1000` | Límite por página en peticiones Socrata |
| `SECOP_SYNC_MAX_RECORDS` | Entero positivo | `5000` | Límite máximo de registros por corrida de sync |
| `SECOP_SYNC_WINDOW_DAYS` | Entero positivo | `14` | Ventana temporal retroactiva en días |
| `ANALYSIS_CONCURRENCY` | Entero positivo | `2` | Concurrencia de trabajadores BullMQ de análisis |
| `SEMANTIC_COSINE_LOW` | Float (-1..1) | `0.4` | Umbral inferior de similitud semántica |
| `SEMANTIC_COSINE_HIGH` | Float (-1..1) | `0.75` | Umbral superior de similitud semántica |
| `MIN_RECOMMENDATION_SCORE` | Float (0..1) | `0.45` | Afinidad mínima para recomendar |
| `JWT_SECRET` | String (mínimo 32) | *Requerido* | Secreto de firmado JWT (no plantilla en prod) |
| `JWT_ACCESS_TTL` | String | `15m` | Tiempo de vida del token de acceso |
| `JWT_REFRESH_TTL` | String | `7d` | Tiempo de vida del token de refresco |
| `MAX_PROFILES_PER_USER` | Entero positivo | `5` | Máximo de perfiles por cuenta de usuario |
| `CORS_ORIGINS` | Comma-separated | `""` | Orígenes permitidos (vacío = sin CORS) |
| `SMTP_HOST` | String | `localhost` | Host del servidor SMTP |
| `SMTP_PORT` | Entero (1..65535) | `1025` | Puerto SMTP (Mailpit en desarrollo) |
| `SMTP_USER` | String | `""` | Usuario de autenticación SMTP |
| `SMTP_PASS` | String | `""` | Contraseña SMTP |
| `SMTP_FROM` | String | `Pliegos <alertas@pliegos.co>` | Remitente de alertas por correo |
| `SMTP_SECURE` | Booleano | `false` | Conexión SSL/TLS directa |
| `RECOMMEND_DEADLINE_ALERTS` | Booleano | `false` | Alertas de vencimiento para top recomendaciones |

---

## 🧪 Pruebas Automatizadas

El proyecto cuenta con una cobertura integral de pruebas unitarias, de integración y End-to-End:

```bash
# Ejecutar todas las suites de prueba (53 suites, 458 tests)
pnpm test

# Ejecutar pruebas en modo watch
pnpm run test:watch

# Generar reporte de cobertura de código
pnpm run test:cov

# Ejecutar flujo completo E2E de verificación
pnpm run e2e
```

---

## 📜 Scripts de package.json

| Script | Descripción |
|---|---|
| `pnpm run build` | Compila el código TypeScript a JavaScript en `./dist`. |
| `pnpm start` | Inicia la aplicación en producción desde `./dist/src/main.js`. |
| `pnpm run start:dev` | Compila y levanta la aplicación con el modo watch nativo de Node.js. |
| `pnpm run start:api` | Inicia el servicio API HTTP (`ROLE=api`). |
| `pnpm run start:worker` | Inicia el proceso de tareas en segundo plano (`ROLE=worker`). |
| `pnpm run db:migrate` | Aplica migraciones SQL de `migrations/` contra `DATABASE_URL` (idempotente). |
| `pnpm test` | Ejecuta la suite completa de pruebas con Jest (53 suites, 458 tests). |
| `pnpm run test:watch` | Ejecuta las pruebas en modo interactivo watch. |
| `pnpm run test:cov` | Ejecuta las pruebas y calcula la cobertura de código. |
| `pnpm run audit:data` | Auditoría de calidad de datos y cobertura de oportunidades recomendables. |
| `pnpm run reindex` | Genera embeddings para oportunidades recomendables pendientes y encola refresco. |
| `pnpm run backfill:departments` | Backfill e idempotencia de departamentos colombianos canónicos. |
| `pnpm run resync:unknown` | Reintenta la ingesta desde SECOP para oportunidades con estado Unknown. |
| `pnpm run eval:export` | Exporta muestra de oportunidades para etiquetado de relevancia. |
| `pnpm run eval:run` | Ejecuta la evaluación contra `eval/labels.json` y compara con `eval/thresholds.json`. |
| `pnpm run admin:create` | Crea un usuario administrador (`pnpm run admin:create <email> <password>`). |
| `pnpm run lint` | Analiza el código con ESLint. |
| `pnpm run lint:fix` | Corrige advertencias de formato y estilo con ESLint. |
| `pnpm run format:check` | Comprueba el formateo del repositorio con Prettier. |
| `pnpm run check:arch` | Verifica las reglas de arquitectura hexagonal con Dependency Cruiser. |
| `pnpm run check:ollama` | Valida la conectividad con Ollama y la generación de embeddings. |
| `pnpm run e2e` | Ejecuta el script de verificación del flujo de extremo a extremo. |
