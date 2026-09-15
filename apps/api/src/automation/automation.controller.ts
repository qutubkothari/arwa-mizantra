import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AutomationService } from './automation.service';

@Controller('automation')
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Get('rules')
  listRules(@Request() req: any, @Query() query: any) { return this.automationService.listRules(req.user.tenantId, query); }

  @Post('rules')
  createRule(@Request() req: any, @Body() body: any) { return this.automationService.createRule(req.user.tenantId, req.user.userId, body); }

  @Put('rules/:id')
  updateRule(@Request() req: any, @Param('id') id: string, @Body() body: any) { return this.automationService.updateRule(req.user.tenantId, id, body); }

  @Delete('rules/:id')
  deleteRule(@Request() req: any, @Param('id') id: string) { return this.automationService.deleteRule(req.user.tenantId, id); }

  @Post('rules/:id/preview')
  preview(@Request() req: any, @Param('id') id: string) { return this.automationService.runRule(req.user.tenantId, req.user.userId, id, false); }

  @Post('rules/:id/run')
  run(@Request() req: any, @Param('id') id: string) { return this.automationService.runRule(req.user.tenantId, req.user.userId, id, true); }

  @Post('rules/run-active')
  runActiveRules(@Request() req: any) { return this.automationService.runActiveRules(req.user.tenantId, req.user.userId); }

  @Get('runs')
  runs(@Request() req: any, @Query() query: any) { return this.automationService.listRuns(req.user.tenantId, query); }

  @Get('communications')
  communications(@Request() req: any, @Query() query: any) { return this.automationService.listCommunications(req.user.tenantId, query); }

  @Patch('communications/:id/read')
  markCommunicationRead(@Request() req: any, @Param('id') id: string) { return this.automationService.markCommunicationRead(req.user.tenantId, id); }

  @Get('tasks')
  tasks(@Request() req: any, @Query() query: any) { return this.automationService.listTasks(req.user.tenantId, query); }

  @Patch('tasks/:id')
  updateTask(@Request() req: any, @Param('id') id: string, @Body() body: any) { return this.automationService.updateTask(req.user.tenantId, req.user.userId, id, body); }

  @Get('branches')
  branches(@Request() req: any) { return this.automationService.listBranches(req.user.tenantId); }

  @Post('branches')
  createBranch(@Request() req: any, @Body() body: any) { return this.automationService.createBranch(req.user.tenantId, body); }

  @Put('branches/:id')
  updateBranch(@Request() req: any, @Param('id') id: string, @Body() body: any) { return this.automationService.updateBranch(req.user.tenantId, id, body); }
}
