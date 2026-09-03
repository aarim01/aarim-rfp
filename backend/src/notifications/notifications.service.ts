import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Queue } from 'bull';
import { Resend } from 'resend';
import { Notification } from './entities/notification.entity';
import { NotificationHistory } from './entities/notification-history.entity';
import { User } from '../auth/entities/user.entity';
import { Tender } from '../tenders/entities/tender.entity';
import { TenderMatch } from '../matching/entities/tender-match.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null;

  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(NotificationHistory)
    private readonly historyRepository: Repository<NotificationHistory>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Tender)
    private readonly tendersRepository: Repository<Tender>,
    @InjectRepository(TenderMatch)
    private readonly matchesRepository: Repository<TenderMatch>,
    @Optional()
    @InjectQueue('notifications')
    private readonly notificationsQueue: Queue | undefined,
    private readonly configService: ConfigService,
  ) {
    const resendKey = this.configService.get<string>('RESEND_API_KEY');
    this.resend = resendKey ? new Resend(resendKey) : null;
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    return this.notificationsRepository.save(this.notificationsRepository.create(dto));
  }

  async findAll(userId: string): Promise<Notification[]> {
    return this.notificationsRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Notification | null> {
    return this.notificationsRepository.findOne({ where: { id } });
  }

  async getNotificationHistory(userId: string): Promise<NotificationHistory[]> {
    return this.historyRepository.find({
      where: { user_id: userId },
      order: { sent_at: 'DESC' },
    });
  }

  async remove(id: string): Promise<void> {
    await this.notificationsRepository.delete(id);
  }

  async queueHighScoreMatches(threshold = 80): Promise<void> {
    if (!this.notificationsQueue) return;
    const matches = await this.matchesRepository.find({
      where: { match_score: MoreThan(threshold) },
      relations: ['company', 'company.user'],
    });

    for (const match of matches) {
      const userId = match.company?.user?.id;
      if (userId) {
        await this.notificationsQueue.add('send-email', {
          userId,
          tenderId: match.tender_id,
          matchId: match.id,
        });
      }
    }
  }

  async queueMatchEmail(userId: string, tenderId: string, matchId: string): Promise<void> {
    if (!this.notificationsQueue) return;
    await this.notificationsQueue.add('send-email', { userId, tenderId, matchId });
  }

  async sendMatchEmail(userId: string, tenderId: string, matchId: string): Promise<void> {
    const [user, tender, match] = await Promise.all([
      this.usersRepository.findOne({ where: { id: userId } }),
      this.tendersRepository.findOne({ where: { id: tenderId } }),
      this.matchesRepository.findOne({ where: { id: matchId } }),
    ]);

    if (!user || !tender || !match) {
      throw new Error('Notification data could not be found');
    }

    const subject = `New tender match: ${tender.title}`;
    const message = `Your company matched ${match.match_score}% with "${tender.title}".\n\n${match.match_explanation || ''}`;
    const notification = await this.create({
      user_id: userId,
      tender_id: tenderId,
      match_id: matchId,
      type: 'email',
      subject,
      message,
    });

    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY is not configured; email notification was stored only');
      return;
    }

    await this.resend.emails.send({
      from: this.configService.get<string>('RESEND_FROM_EMAIL') || 'noreply@example.com',
      to: user.email,
      subject,
      text: message,
    });

    notification.status = 'sent';
    notification.sent_at = new Date();
    await this.notificationsRepository.save(notification);
    await this.historyRepository.save(this.historyRepository.create({
      user_id: userId,
      notification_type: 'match',
      content: message,
    }));
  }

  async sendDigest(days: number): Promise<void> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const notifications = await this.notificationsRepository.find({
      where: { created_at: MoreThan(since), type: 'email' },
      relations: ['user'],
    });

    for (const notification of notifications) {
      if (notification.status === 'pending' && notification.user) {
        await this.sendStoredEmail(notification);
      }
    }
  }

  private async sendStoredEmail(notification: Notification): Promise<void> {
    if (!this.resend || !notification.user?.email) return;

    await this.resend.emails.send({
      from: this.configService.get<string>('RESEND_FROM_EMAIL') || 'noreply@example.com',
      to: notification.user.email,
      subject: notification.subject || 'Tender notification',
      text: notification.message || '',
    });
    notification.status = 'sent';
    notification.sent_at = new Date();
    await this.notificationsRepository.save(notification);
  }
}
