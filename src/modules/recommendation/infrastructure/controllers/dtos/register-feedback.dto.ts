import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const registerFeedbackSchema = z.object({
  decision: z.enum(['Participate', 'Discard'], {
    message: "decision must be either 'Participate' or 'Discard'",
  }),
});

export type RegisterFeedbackInput = z.infer<typeof registerFeedbackSchema>;

export class RegisterFeedbackDto {
  @ApiProperty({
    description:
      'Decisión tomada por el contratista respecto a la recomendación',
    enum: ['Participate', 'Discard'],
    example: 'Participate',
  })
  decision!: 'Participate' | 'Discard';
}
