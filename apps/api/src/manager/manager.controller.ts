import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ManagerService } from './manager.service';

@Controller('manager')
@UseGuards(AuthGuard('jwt'))
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('pending-approvals')
  async getPendingApprovals(@Req() req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId || req.user.id || req.user.sub;
    return this.managerService.getPendingApprovals(tenantId, userId);
  }
}
