import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User } from '../auth/entities/user.entity';
import { CompanyProfile } from '../company/entities/company-profile.entity';
import { ScrapingSource } from '../tenders/entities/scraping-source.entity';
import { SystemLog } from './entities/system-log.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { InviteCode } from '../auth/entities/invite-code.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CompanyProfile)
    private companyProfileRepository: Repository<CompanyProfile>,
    @InjectRepository(ScrapingSource)
    private scrapingSourceRepository: Repository<ScrapingSource>,
    @InjectRepository(SystemLog)
    private systemLogRepository: Repository<SystemLog>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    @InjectRepository(InviteCode)
    private inviteCodeRepository: Repository<InviteCode>,
  ) {}

  async getUsers(page: number = 1, limit: number = 10) {
    const [users, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
      select: ['id', 'email', 'first_name', 'last_name', 'role', 'is_active', 'created_at'],
    });

    return { users, total };
  }

  async getUser(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['company_profiles'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateUserRole(id: string, role: string) {
    const user = await this.getUser(id);
    user.role = role;
    return this.userRepository.save(user);
  }

  async toggleUserStatus(id: string) {
    const user = await this.getUser(id);
    user.is_active = !user.is_active;
    return this.userRepository.save(user);
  }

  async deleteUser(id: string) {
    const user = await this.getUser(id);
    return this.userRepository.remove(user);
  }

  async getSystemStats() {
    const totalUsers = await this.userRepository.count();
    const activeUsers = await this.userRepository.count({ where: { is_active: true } });
    const totalCompanies = await this.companyProfileRepository.count();
    const totalSources = await this.scrapingSourceRepository.count();
    const activeSources = await this.scrapingSourceRepository.count({ where: { is_active: true } });

    return {
      totalUsers,
      activeUsers,
      totalCompanies,
      totalSources,
      activeSources,
    };
  }

  async getLogs(level?: string, page: number = 1, limit: number = 50) {
    const queryBuilder = this.systemLogRepository.createQueryBuilder('log');

    if (level) {
      queryBuilder.andWhere('log.level = :level', { level });
    }

    const [logs, total] = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('log.created_at', 'DESC')
      .getManyAndCount();

    return { logs, total };
  }

  async createLog(level: string, message: string, module?: string, metadata?: Record<string, any>) {
    const log = this.systemLogRepository.create({
      level,
      message,
      module,
      metadata,
    });
    return this.systemLogRepository.save(log);
  }

  async getAuditLogs(page: number = 1, limit: number = 50) {
    const [logs, total] = await this.auditLogRepository.findAndCount({
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['user'],
    });
    return { logs, total };
  }

  async getInviteCodes() {
    return this.inviteCodeRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  async createInviteCode(maxUses: number = 1, expiresInDays?: number, adminUserId?: string) {
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;
    const invite = this.inviteCodeRepository.create({
      code: crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      role: 'company_user',
      max_uses: maxUses,
      uses: 0,
      expires_at: expiresAt,
      created_by: adminUserId,
    });
    return this.inviteCodeRepository.save(invite);
  }
}
