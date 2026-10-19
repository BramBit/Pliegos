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

@Module({
  imports: [
    BullModule.registerQueue({ name: ADMIN_TASKS_QUEUE_NAME }),
    OpportunityModule,
    AlertModule,
    ProfileModule,
  ],
  controllers: [AdminController],
  providers: [
    {
      provide: ADMIN_QUEUE_PORT,
      useFactory: (queue: Queue) => new BullMQAdminQueueAdapter(queue),
      inject: [getQueueToken(ADMIN_TASKS_QUEUE_NAME)],
    },
    AdminTaskProcessor,
  ],
  exports: [ADMIN_QUEUE_PORT],
})
export class AdminModule {}
