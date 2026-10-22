# Architectural Boundary Violations Report (P6.5)

Este documento registra las violaciones de fronteras arquitectónicas detectadas por `dependency-cruiser` al introducir las reglas hexagonales en el paso P6.5.

Conforme a la instrucción del plan:

> _"Existing violations are NOT fixed silently: list them in docs/arch-violations.md for me to decide."_

Ninguna de estas violaciones ha sido corregida silenciosamente. Han sido añadidas a la línea base `.dependency-cruiser-known-violations.json` para que `pnpm check:arch` prevenga cualquier nueva regresión, mientras que las violaciones existentes quedan documentadas aquí para decisión y priorización de refactorización.

---

## Resumen Cuantitativo

- **Total de violaciones detectadas:** 20
  - **Errores de frontera Domain → Infrastructure:** 3
  - **Errores de frontera Application → Infrastructure:** 13
  - **Advertencias de dependencias circulares:** 4

---

## 1. Domain → Infrastructure (3 violaciones)

En la arquitectura hexagonal, la capa de dominio (`modules/*/domain`) debe ser completamente independiente de la infraestructura y tecnologías externas.

| Archivo origen                                                      | Archivo destino importado                                                           | Causa raíz                                                                                                       | Propuesta de resolución                                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/recommendation/domain/services/matching.service.ts`    | `src/modules/opportunity/infrastructure/adapters/secop/normalizers.ts`              | `MatchingService` importa `normalizeModality` para comparar modalidades.                                         | Extraer la lógica pura de normalización de modalidades a un Value Object del dominio (ej. `src/modules/opportunity/domain/value-objects/modality.ts`) o a un servicio de dominio compartido. |
| `src/modules/profile/domain/value-objects/profile.value-objects.ts` | `src/modules/opportunity/infrastructure/adapters/secop/normalizers.ts`              | `Profile` importa `normalizeModality` para normalizar las modalidades de preferencia del perfil.                 | Se resuelve automáticamente al mover `normalizeModality` a la capa de dominio.                                                                                                               |
| `src/modules/admin/domain/ports/admin-queue.port.ts`                | `src/modules/opportunity/infrastructure/controllers/dtos/sync-opportunities.dto.ts` | El puerto de dominio `AdminQueuePort` tipa su payload usando el DTO del controlador HTTP `SyncOpportunitiesDto`. | Definir una interfaz propia en el puerto de dominio (ej. `SyncOpportunitiesOptions`) y realizar el mapeo en el controlador/adaptador.                                                        |

---

## 2. Application → Infrastructure (13 violaciones)

La capa de aplicación (`modules/*/application`) debe depender únicamente de puertos (interfaces) y modelos de dominio, nunca de clases concretas o archivos de infraestructura.

### 2.1. Acoplamiento a hashing y seguridad en Auth

| Archivo origen                                                     | Archivo destino importado                                             | Causa raíz                                                                    | Propuesta de resolución                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/modules/auth/application/use-cases/register.use-case.ts`      | `src/modules/auth/infrastructure/security/password-hasher.ts`         | Importación directa de funciones utilitarias criptográficas (`hashPassword`). | Definir el puerto `PasswordHasherPort` e inyectar la implementación mediante el contenedor IoC. |
| `src/modules/auth/application/use-cases/login.use-case.ts`         | `src/modules/auth/infrastructure/security/password-hasher.ts`         | Importación directa de `verifyPassword`.                                      | Usar el puerto `PasswordHasherPort`.                                                            |
| `src/modules/auth/application/use-cases/login.use-case.ts`         | `src/modules/auth/infrastructure/security/token-hasher.ts`            | Importación directa de `hashToken`.                                           | Definir el puerto `TokenHasherPort` o abstraer el servicio en el dominio.                       |
| `src/modules/auth/application/use-cases/login.use-case.ts`         | `src/modules/auth/infrastructure/security/login-throttler.service.ts` | Inyección de la clase concreta `LoginThrottlerService`.                       | Definir el puerto `LoginThrottlerPort` en la capa de aplicación/dominio.                        |
| `src/modules/auth/application/use-cases/refresh-token.use-case.ts` | `src/modules/auth/infrastructure/security/token-hasher.ts`            | Importación directa de utilitario de hashing.                                 | Usar el puerto `TokenHasherPort`.                                                               |
| `src/modules/auth/application/use-cases/logout.use-case.ts`        | `src/modules/auth/infrastructure/security/token-hasher.ts`            | Importación directa de utilitario de hashing.                                 | Usar el puerto `TokenHasherPort`.                                                               |

### 2.2. Acoplamiento a Jobs y Queues en Use Cases

| Archivo origen                                                                         | Archivo destino importado                                                | Causa raíz                                                              | Propuesta de resolución                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/recommendation/application/use-cases/refresh-recommendations.use-case.ts` | `src/modules/opportunity/infrastructure/jobs/analyze-opportunity.job.ts` | Referencia al nombre de la cola o constante del job de infraestructura. | Mover las constantes y tokens de cola a `queue.tokens.ts` o abstraer el encolador detrás de un puerto `RefreshQueuePort`. |
| `src/modules/opportunity/application/use-cases/get-opportunity-by-id.use-case.ts`      | `src/modules/opportunity/infrastructure/jobs/analyze-opportunity.job.ts` | Referencia directa al job/cola para encolar análisis bajo demanda.      | Inyectar `AnalysisQueuePort` (puerto ya existente) en vez de importar el job concreto.                                    |

### 2.3. Acoplamiento a Decoradores HTTP y Excepciones en Profile

| Archivo origen                                                            | Archivo destino importado                                            | Causa raíz                                                                              | Propuesta de resolución                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/modules/profile/application/services/profile-access.service.ts`      | `src/modules/shared/infrastructure/http/global-exception.filter.ts`  | Importa la clase de error `ProfileNotFoundError` definida en el filtro HTTP compartido. | Mover `ProfileNotFoundError` a `src/modules/profile/domain/errors/` o errores de aplicación. |
| `src/modules/profile/application/services/profile-access.service.ts`      | `src/modules/auth/infrastructure/security/current-user.decorator.ts` | Importa la interfaz `CurrentUserPayload` del decorador NestJS.                          | Definir un tipo de dominio/aplicación `AuthenticatedUser` en `src/modules/auth/domain/`.     |
| `src/modules/profile/application/services/profile-access.service.spec.ts` | `src/modules/shared/infrastructure/http/global-exception.filter.ts`  | Importa `ProfileNotFoundError` en la suite de pruebas unitarias.                        | Se resuelve al mover la clase de error al dominio/aplicación.                                |

### 2.4. Acoplamiento a Persistencia en Alert

| Archivo origen                                                            | Archivo destino importado                                                            | Causa raíz                                                                                             | Propuesta de resolución                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/alert/application/use-cases/scan-deadlines.use-case.ts`      | `src/modules/shared/infrastructure/persistence/database.module.ts`                   | Importa el token `DATABASE_POOL` directamente desde el módulo de persistencia.                         | Utilizar el token desacoplado en `database.tokens.ts` o resolver la consulta a través de un método en `OpportunityRepositoryPort`. |
| `src/modules/alert/application/use-cases/scan-deadlines.use-case.spec.ts` | `src/modules/alert/infrastructure/adapters/persistence/postgres-alert.repository.ts` | El test unitario del caso de uso instancia el repositorio Postgres real en vez de usar un fake o mock. | Reemplazar por un mock o InMemory repository conforme al estándar de pruebas de casos de uso (AGENT.md §6).                        |

---

## 3. Dependencias Circulares (4 advertencias)

| Ciclo detectado                                                                     | Causa                                                            | Propuesta de resolución                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `opportunity.module.ts` ⇄ `recommendation.module.ts`                                | Referencias mutuas entre módulos para inyección de dependencias. | Usar `forwardRef()` o extraer la dependencia compartida a un módulo intermedio.             |
| `alert.module.ts` ⇄ `opportunity.module.ts`                                         | Referencias cruzadas de módulos.                                 | Desacoplar mediante eventos de dominio o módulo mediador.                                   |
| `opportunity-filters.ts` ⇄ `opportunity.value-objects.ts`                           | Importación cíclica de tipos y funciones de validación.          | Unificar o extraer tipos comunes a un archivo base independiente dentro de `value-objects`. |
| `opportunity.entity.ts` ⇄ `opportunity.value-objects.ts` ⇄ `opportunity-filters.ts` | Ciclo de dependencias entre la entidad y sus value objects.      | Reordenar exportaciones y separar tipos base de la lógica de construcción de filtros.       |
