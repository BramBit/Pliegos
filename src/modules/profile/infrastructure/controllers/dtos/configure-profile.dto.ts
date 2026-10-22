import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { canonicalizeDepartment } from '../../../domain/value-objects/colombian-departments';

export const amountRangeSchema = z
  .object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
  })
  .refine((data) => data.min <= data.max, {
    message: 'min cannot exceed max',
    path: ['min'],
  });

export const capabilitySchema = z.object({
  name: z.string().min(1),
  yearsOfExperience: z.number().nonnegative(),
});

export const profilePreferencesSchema = z.object({
  categoryCodes: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  amountRange: amountRangeSchema.nullable().optional(),
  departments: z
    .array(z.string())
    .default([])
    .superRefine((depts, ctx) => {
      for (let i = 0; i < depts.length; i++) {
        const canonical = canonicalizeDepartment(depts[i]);
        if (!canonical) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown Colombian department: "${depts[i]}". Must match one of the 33 canonical Colombian departments (including Bogotá D.C.).`,
            path: [i],
          });
        }
      }
    }),
});

export const configureProfileSchema = z.object({
  profileId: z.string().uuid().optional(),
  ownerId: z.string().min(1).optional(),
  name: z.string().trim().min(1).optional().nullable(),
  contactEmail: z.string().trim().email().optional().nullable(),
  alertsEnabled: z.boolean().default(true),
  deadlineAlertDays: z.number().int().min(1).max(30).default(3),
  sector: z.string().min(1),
  capabilities: z.array(capabilitySchema).default([]),
  preferences: profilePreferencesSchema,
});

export type ConfigureProfileInput = z.infer<typeof configureProfileSchema>;

export class AmountRangeDto {
  @ApiProperty({ description: 'Monto mínimo en COP', example: 10000000 })
  min!: number;

  @ApiProperty({ description: 'Monto máximo en COP', example: 200000000 })
  max!: number;
}

export class CapabilityDto {
  @ApiProperty({
    description: 'Nombre o denominación de la capacidad técnica',
    example: 'Desarrollo Cloud y DevOps',
  })
  name!: string;

  @ApiProperty({ description: 'Años de experiencia demostrable', example: 5 })
  yearsOfExperience!: number;
}

export class ProfilePreferencesDto {
  @ApiProperty({
    description: 'Códigos UNSPSC de interés para contratación',
    example: ['V1.80111600', 'V1.81111500'],
    type: [String],
  })
  categoryCodes!: string[];

  @ApiProperty({
    description:
      'Palabras clave libres que alimentan la similitud semántica con IA',
    example: ['software', 'ciberseguridad', 'consultoría ti'],
    type: [String],
  })
  keywords!: string[];

  @ApiPropertyOptional({
    description: 'Rango de cuantía deseada en COP',
    type: AmountRangeDto,
  })
  amountRange?: AmountRangeDto | null;

  @ApiProperty({
    description:
      'Departamentos de interés geográfico (vacío = sin preferencia, deben ser válidos en Colombia)',
    example: ['Antioquia', 'Bogotá D.C.'],
    type: [String],
  })
  departments!: string[];
}

export class ConfigureProfileDto {
  @ApiPropertyOptional({
    description:
      'ID único del perfil en caso de actualización (omite para generar uno nuevo automáticamente)',
    example: 'd9b2d63d-a232-4d2c-8cb4-e5e6b72a44f1',
  })
  profileId?: string;

  @ApiPropertyOptional({
    description:
      'Identificador del usuario propietario del perfil (provisto automáticamente del token)',
    example: 'user-empresa-123',
  })
  ownerId?: string;

  @ApiPropertyOptional({
    description: 'Nombre comercial o razón social del contratista',
    example: 'Tech Solutions SAS',
  })
  name?: string | null;

  @ApiPropertyOptional({
    description: 'Correo electrónico de contacto para notificaciones y alertas',
    example: 'licitaciones@techsolutions.com',
  })
  contactEmail?: string | null;

  @ApiPropertyOptional({
    description: 'Indica si las alertas automáticas están activadas',
    example: true,
    default: true,
  })
  alertsEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Anticipación en días para alertar sobre cierre de convocatorias',
    example: 3,
    default: 3,
  })
  deadlineAlertDays?: number;

  @ApiProperty({
    description: 'Sector económico principal del contratista',
    example: 'Tecnología e Información',
  })
  sector!: string;

  @ApiProperty({
    description: 'Listado de capacidades y experiencia del contratista',
    type: [CapabilityDto],
  })
  capabilities!: CapabilityDto[];

  @ApiProperty({
    description: 'Preferencias de contratación para el motor de priorización',
    type: ProfilePreferencesDto,
  })
  preferences!: ProfilePreferencesDto;
}
