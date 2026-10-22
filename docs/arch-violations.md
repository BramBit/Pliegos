# Architectural Boundary Violations Report (P6.5 / Actualizado en P7.7)

Este documento registra las violaciones de fronteras arquitectónicas detectadas por `dependency-cruiser` al introducir las reglas hexagonales en el paso P6.5 y su resolución/clasificación en P7.7.

Conforme a la instrucción del plan P7.7:

> _"For each of the 20 listed violations write one line: "fix now (under 15 lines)" or "leave (reason)". Fix the "fix now" ones, one commit per module. Update the dependency-cruiser baseline so check:arch fails only on NEW violations, and update the file with what remains."_

---

## Resumen Cuantitativo

- **Total de violaciones iniciales:** 20
- **Violaciones resueltas en P7.7:** 6
- **Violaciones remanentes en línea base:** 14
  - **Domain → Infrastructure:** 0 (todas resueltas)
  - **Application → Infrastructure:** 10 (mantenidas por regla STOP IF)
  - **Advertencias circulares:** 4 (mantenidas)

---

## 1. Domain → Infrastructure (3 violaciones — 3 resueltas)

En la arquitectura hexagonal, la capa de dominio (`modules/*/domain`) debe ser completamente independiente de la infraestructura y tecnologías externas.

| Archivo origen                                                      | Archivo destino importado                                                           | Decisión P7.7                                                                                                            | Estado       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `src/modules/recommendation/domain/services/matching.service.ts`    | `src/modules/opportunity/infrastructure/adapters/secop/normalizers.ts`              | **fix now (under 15 lines)**: se movió la función pura `normalizeUnspsc` a `opportunity.value-objects.ts` en el dominio. | **Resuelto** |
| `src/modules/profile/domain/value-objects/profile.value-objects.ts` | `src/modules/opportunity/infrastructure/adapters/secop/normalizers.ts`              | **fix now (under 15 lines)**: se importa `normalizeUnspsc` desde `opportunity.value-objects.ts` del dominio.             | **Resuelto** |
| `src/modules/admin/domain/ports/admin-queue.port.ts`                | `src/modules/opportunity/infrastructure/controllers/dtos/sync-opportunities.dto.ts` | **fix now (under 15 lines)**: se reemplazó el DTO HTTP por la interfaz de dominio `EnqueueSyncOptions`.                  | **Resuelto** |

---

## 2. Application → Infrastructure (13 violaciones — 3 resueltas, 10 remanentes)

La capa de aplicación (`modules/*/application`) debe depender únicamente de puertos (interfaces) y modelos de dominio, nunca de clases concretas o archivos de infraestructura.

### 2.1. Acoplamiento a hashing y seguridad en Auth

| Archivo origen                                                     | Archivo destino importado                                             | Decisión P7.7                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/modules/auth/application/use-cases/register.use-case.ts`      | `src/modules/auth/infrastructure/security/password-hasher.ts`         | **leave (needs new PasswordHasherPort and DI wiring; forbidden by STOP IF rule)** |
| `src/modules/auth/application/use-cases/login.use-case.ts`         | `src/modules/auth/infrastructure/security/password-hasher.ts`         | **leave (needs new PasswordHasherPort and DI wiring; forbidden by STOP IF rule)** |
| `src/modules/auth/application/use-cases/login.use-case.ts`         | `src/modules/auth/infrastructure/security/token-hasher.ts`            | **leave (needs new TokenHasherPort and DI wiring; forbidden by STOP IF rule)**    |
| `src/modules/auth/application/use-cases/login.use-case.ts`         | `src/modules/auth/infrastructure/security/login-throttler.service.ts` | **leave (needs new LoginThrottlerPort and DI wiring; forbidden by STOP IF rule)** |
| `src/modules/auth/application/use-cases/refresh-token.use-case.ts` | `src/modules/auth/infrastructure/security/token-hasher.ts`            | **leave (needs new TokenHasherPort and DI wiring; forbidden by STOP IF rule)**    |
| `src/modules/auth/application/use-cases/logout.use-case.ts`        | `src/modules/auth/infrastructure/security/token-hasher.ts`            | **leave (needs new TokenHasherPort and DI wiring; forbidden by STOP IF rule)**    |

### 2.2. Acoplamiento a Jobs en Use Cases

| Archivo origen                                                                         | Archivo destino importado                                                | Decisión P7.7                                                                                          | Estado       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------ |
| `src/modules/recommendation/application/use-cases/refresh-recommendations.use-case.ts` | `src/modules/opportunity/infrastructure/jobs/analyze-opportunity.job.ts` | **fix now (under 15 lines)**: se movió `hasGeneratedSummary` a la entidad `Opportunity` en el dominio. | **Resuelto** |
| `src/modules/opportunity/application/use-cases/get-opportunity-by-id.use-case.ts`      | `src/modules/opportunity/infrastructure/jobs/analyze-opportunity.job.ts` | **fix now (under 15 lines)**: se importa `hasGeneratedSummary` desde la entidad de dominio.            | **Resuelto** |

### 2.3. Acoplamiento a Decoradores HTTP y Excepciones en Profile

| Archivo origen                                                            | Archivo destino importado                                            | Decisión P7.7                                                                                                                                                           | Estado       |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `src/modules/profile/application/services/profile-access.service.ts`      | `src/modules/auth/infrastructure/security/current-user.decorator.ts` | **fix now (under 15 lines)**: se reemplazó el tipo por interfaz de usuario estructural `{ readonly sub: string; readonly role?: string }`.                              | **Resuelto** |
| `src/modules/profile/application/services/profile-access.service.ts`      | `src/modules/shared/infrastructure/http/global-exception.filter.ts`  | **leave (assertOwner throws DomainErrorException to integrate directly with HTTP layer; changing requires changing error propagation or adding a dedicated exception)** | Remanente    |
| `src/modules/profile/application/services/profile-access.service.spec.ts` | `src/modules/shared/infrastructure/http/global-exception.filter.ts`  | **leave (test asserts DomainErrorException thrown by assertOwner)**                                                                                                     | Remanente    |

### 2.4. Acoplamiento a Persistencia en Alert

| Archivo origen                                                            | Archivo destino importado                                                            | Decisión P7.7                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/alert/application/use-cases/scan-deadlines.use-case.ts`      | `src/modules/shared/infrastructure/persistence/database.module.ts`                   | **leave (direct pool query requires adding new query method to OpportunityRepositoryPort or AlertRepositoryPort; forbidden by STOP IF rule)** |
| `src/modules/alert/application/use-cases/scan-deadlines.use-case.spec.ts` | `src/modules/alert/infrastructure/adapters/persistence/postgres-alert.repository.ts` | **leave (test uses concrete repository; refactor would require changing test setup)**                                                         |

---

## 3. Dependencias Circulares (4 advertencias)

| Ciclo detectado                                                                     | Causa                                                            | Decisión P7.7                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `opportunity.module.ts` ⇄ `recommendation.module.ts`                                | Referencias mutuas entre módulos para inyección de dependencias. | **leave (NestJS cross-module DI imports; requires mediator or event bus in a later phase)** |
| `alert.module.ts` ⇄ `opportunity.module.ts`                                         | Referencias cruzadas de módulos.                                 | **leave (NestJS cross-module DI imports; requires mediator or event bus in a later phase)** |
| `opportunity-filters.ts` ⇄ `opportunity.value-objects.ts`                           | Importación cíclica de tipos y funciones de validación.          | **leave (circular re-export between domain value-objects barrel and filters interface)**    |
| `opportunity.entity.ts` ⇄ `opportunity.value-objects.ts` ⇄ `opportunity-filters.ts` | Ciclo de dependencias entre la entidad y sus value objects.      | **leave (type-level cycle between Opportunity entity and OpportunityFilters result type)**  |
