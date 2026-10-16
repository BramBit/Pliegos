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
   - Cola asíncrona de análisis (`AnalyzeOpportunityJob` con BullMQ y Redis) para generación de embeddings y extracción de requisitos sin bloquear la ingesta.

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
Inicia la base de datos PostgreSQL (con soporte `pgvector`) y Redis con un solo comando:
```bash
docker compose up -d
```
Verifica que los contenedores estén saludables:
```bash
docker compose ps
```

### 4. Instalar Dependencias
```bash
pnpm install
```

### 5. Inicializar el Esquema de Base de Datos
Ejecuta el script que aplica la extensión `vector`, las tablas y los índices HNSW:
```bash
pnpm run db:init
```

### 6. Iniciar la Aplicación

**Modo Desarrollo (con recarga automática):**
```bash
pnpm run start:dev
```

**Modo Producción:**
```bash
pnpm run build
pnpm start
```

La consola confirmará el inicio del servicio:
```text
[Bootstrap] Pliegos API running on http://localhost:3000
[Bootstrap] Scalar API Reference available at http://localhost:3000/reference
[Bootstrap] OpenAPI JSON available at http://localhost:3000/api-json
```

---

## 📖 Exploración de la API

Abre tu navegador en:
👉 **[http://localhost:3000/reference](http://localhost:3000/reference)**

Desde la interfaz interactiva de Scalar podrás probar en vivo endpoints como:
- `POST /opportunities/sync`: Sincronización manual de procesos desde SECOP II.
- `POST /opportunities/search`: Búsqueda híbrida estructurada y vectorial.
- `POST /profiles`: Creación y actualización de perfiles de contratista.
- `GET /recommendations/:profileId`: Cálculo de afinidad explicada.
- `POST /recommendations/:id/feedback`: Registro de decisiones del usuario.
- `POST /alerts/review-follow-up`: Disparo de revisión y envío de alertas.

---

## 🧪 Pruebas Automatizadas

El proyecto cuenta con una cobertura integral de pruebas unitarias, de integración (repositorios reales sobre PostgreSQL) y End-to-End:

```bash
# Ejecutar todas las suites de prueba (147 tests)
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
| `pnpm run db:init` | Aplica el DDL de base de datos (`vector`, tablas e índices) contra PostgreSQL. |
| `pnpm test` | Ejecuta la suite completa de pruebas con Jest. |
| `pnpm run test:cov` | Ejecuta las pruebas y calcula la cobertura de código. |
| `pnpm run check:ollama`| Valida la conectividad con Ollama y la generación de embeddings. |
| `pnpm run e2e` | Ejecuta el script de verificación del flujo de extremo a extremo. |
