import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { GetUser } from '../common/decorators/user.decorator';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  async getStats() {
    return this.adminService.getSystemStats();
  }

  @Get('users')
  async getUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getUsers(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 10,
    );
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Put('users/:id/role')
  async updateUserRole(
    @Param('id') id: string,
    @Body('role') role: string,
  ) {
    return this.adminService.updateUserRole(id, role);
  }

  @Put('users/:id/status')
  async toggleUserStatus(@Param('id') id: string) {
    return this.adminService.toggleUserStatus(id);
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Get('logs')
  async getLogs(
    @Query('level') level?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getLogs(
      level,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  @Post('logs')
  async createLog(
    @Body() body: { level: string; message: string; module?: string; metadata?: Record<string, any> },
  ) {
    return this.adminService.createLog(body.level, body.message, body.module, body.metadata);
  }

  @Get('audit-logs')
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getAuditLogs(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  @Patch('users/:id/:action')
  async patchUserStatus(
    @Param('id') id: string,
    @Param('action') action: string,
  ) {
    if (action === 'activate' || action === 'deactivate') {
      return this.adminService.toggleUserStatus(id);
    }
    if (action === 'delete') {
      return this.adminService.deleteUser(id);
    }
    return this.adminService.getUser(id);
  }

  @Get('invite-codes')
  async getInviteCodes() {
    return this.adminService.getInviteCodes();
  }

  @Post('invite-codes')
  async createInviteCode(
    @Body() body: { max_uses?: number; expires_in_days?: number },
    @GetUser() user: any,
  ) {
    return this.adminService.createInviteCode(body.max_uses, body.expires_in_days, user?.id);
  }
}
