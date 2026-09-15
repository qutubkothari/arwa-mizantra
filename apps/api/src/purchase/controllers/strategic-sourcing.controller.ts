import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'; import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { StrategicSourcingService } from '../services/strategic-sourcing.service';
@Controller('purchase/strategic-sourcing') @UseGuards(JwtAuthGuard, PermissionsGuard)
export class StrategicSourcingController { constructor(private readonly service: StrategicSourcingService) {}
  @Get('board') board(@Req() r:any){return this.service.board(r.user.tenantId)}
  @Post('evaluations') evaluate(@Req() r:any,@Body() b:any){return this.service.evaluate(r.user.tenantId,r.user.userId,b)}
  @Post('awards') award(@Req() r:any,@Body() b:any){return this.service.draftAward(r.user.tenantId,r.user.userId,b)}
  @Patch('awards/:id/decision') decide(@Req() r:any,@Param('id') id:string,@Body() b:any){return this.service.decide(r.user.tenantId,r.user.userId,id,b)}
}

