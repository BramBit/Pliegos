import { Controller, Optional } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReviewFollowUpUseCase } from '../../application/use-cases/review-follow-up.use-case';

@ApiTags('Alerts')
@Controller('alerts')
export class AlertController {
  constructor(
    @Optional()
    private readonly reviewFollowUpUseCase?: ReviewFollowUpUseCase,
  ) {}
}
