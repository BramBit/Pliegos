import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { AlertModule } from '../alert/alert.module';
import { SchedulerAdapter } from './scheduler.adapter';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OpportunityModule,
    AlertModule,
  ],
  providers: [SchedulerAdapter],
  exports: [SchedulerAdapter],
})
export class SchedulerModule {}
