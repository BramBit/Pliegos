import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OpportunityModule } from '../opportunity/opportunity.module';
import { AlertModule } from '../alert/alert.module';
import { ProfileModule } from '../profile/profile.module';
import { SchedulerAdapter } from './scheduler.adapter';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OpportunityModule,
    AlertModule,
    ProfileModule,
  ],
  providers: [SchedulerAdapter],
  exports: [SchedulerAdapter],
})
export class SchedulerModule {}
