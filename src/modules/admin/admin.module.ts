import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ADMIN_QUEUE_PORT, ADMIN_TASKS_QUEUE_NAME } from './domain/ports/admin-queue.port';
import { BullMQAdminQueueAdapter } from './infrastructure/adapters/queue/bullmq-admin-queue.adapter';
import { AdminTaskProcessor } from './infrastructure/jobs/admin-task.processor';
import { AdminController } from './infrastructure/controllers/admin.controller';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { AlertModule } from '../alert/alert.module';
import { ProfileModule } from '../profile/profile.module';
import { AiModule } from '../shared/infrastructure/ai/ai.module';
import { PIPELINE_RUN_REPOSITORY_PORT } from './domain/ports/pipeline-run-repository.port';
import { PostgresPipelineRunRepository } from './infrastructure/persistence/postgres-pipeline-run.repository';

@Module({
  imports: [
    BullModule.registerQueue({ name: ADMIN_TASKS_QUEUE_NAME }),
    OpportunityModule,
    AlertModule,
    ProfileModule,
    AiModule,
  ],
  controllers: [AdminController],
  providers: [
    {
      provide: ADMIN_QUEUE_PORT,
      useFactory: (queue: Queue) => new BullMQAdminQueueAdapter(queue),
      inject: [getQueueToken(ADMIN_TASKS_QUEUE_NAME)],
    },
    {
      provide: PIPELINE_RUN_REPOSITORY_PORT,
      useClass: PostgresPipelineRunRepository,
    },
    AdminTaskProcessor,
  ],
  exports: [ADMIN_QUEUE_PORT, PIPELINE_RUN_REPOSITORY_PORT],
})
export class AdminModule {}
