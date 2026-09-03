import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MatchingJob } from './matching.job';
import { NotificationJob } from './notification.job';
import { CronService } from './cron.service';
import { TendersModule } from '../tenders/tenders.module';
import { MatchingModule } from '../matching/matching.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { redisEnabled } from '../config/runtime';

@Module({
  imports: [
    ...(redisEnabled ? [
      BullModule.registerQueue({ name: 'matching' }),
      BullModule.registerQueue({ name: 'notifications' }),
    ] : []),
    TendersModule,
    MatchingModule,
    NotificationsModule,
  ],
  providers: redisEnabled ? [MatchingJob, NotificationJob, CronService] : [],
  exports: redisEnabled ? [MatchingJob, NotificationJob, CronService] : [],
})
export class JobsModule {}
