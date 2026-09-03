import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@nestjs-modules/ioredis';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './company/company.module';
import { TendersModule } from './tenders/tenders.module';
import { MatchingModule } from './matching/matching.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AssistantModule } from './assistant/assistant.module';
import { AdminModule } from './admin/admin.module';
import { JobsModule } from './jobs/jobs.module';
import { CommonModule } from './common/common.module';
import { ScrapingModule } from './scraping/scraping.module';
import { isProduction, redisEnabled } from './config/runtime';

@Module({
  imports: [
    CommonModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        const production = isProduction || configService.get<string>('NODE_ENV') === 'production';

        if (production && !databaseUrl) {
          throw new Error('DATABASE_URL must be configured in production');
        }

        return {
          type: 'postgres' as const,
          ...(databaseUrl
            ? { url: databaseUrl, ssl: { rejectUnauthorized: false } }
            : {
                host: configService.get<string>('DATABASE_HOST'),
                port: parseInt(configService.get<string>('DATABASE_PORT') || '5432'),
                username: configService.get<string>('DATABASE_USERNAME'),
                password: configService.get<string>('DATABASE_PASSWORD'),
                database: configService.get<string>('DATABASE_NAME'),
              }),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: configService.get('DATABASE_SYNCHRONIZE') === 'true',
          logging: configService.get('DATABASE_LOGGING') === 'true',
        };
      },
      inject: [ConfigService],
    }),
    ...(redisEnabled ? [BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        return redisUrl
          ? { redis: redisUrl }
          : {
              redis: {
                host: configService.get<string>('REDIS_HOST'),
                port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
                password: configService.get<string>('REDIS_PASSWORD') || undefined,
              },
            };
      },
      inject: [ConfigService],
    })] : []),
    ...(redisEnabled ? [RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        return redisUrl
          ? { config: { url: redisUrl } }
          : {
              config: {
                host: configService.get<string>('REDIS_HOST'),
                port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
                password: configService.get<string>('REDIS_PASSWORD') || undefined,
              },
            };
      },
      inject: [ConfigService],
    })] : []),
    ScheduleModule.forRoot(),
    AuthModule,
    CompanyModule,
    TendersModule,
    MatchingModule,
    NotificationsModule,
    DashboardModule,
    AssistantModule,
    AdminModule,
    JobsModule,
    ScrapingModule,
  ],
})
export class AppModule {}
