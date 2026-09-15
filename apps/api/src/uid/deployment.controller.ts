import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateDeploymentDto, UpdateDeploymentDto, PublicDeploymentUpdateDto } from './dto/deployment.dto';
import { RequireDelete, RequireCreate, RequireUpdate } from '../auth/decorators/permissions.decorator';

@Controller('uid/deployment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get('status')
  async getStatus(
    @Request() req: any,
    @Query('uid') uid?: string,
    @Query('part_number') partNumber?: string,
    @Query('organization') organization?: string,
    @Query('location') location?: string,
    @Query('search') search?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('sort_by') sortBy?: string,
    @Query('sort_order') sortOrder?: string,
  ) {
    const parsedOffset = offset !== undefined ? Number(offset) : undefined;
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;

    const wantsPagination =
      parsedOffset !== undefined ||
      parsedLimit !== undefined ||
      (search !== undefined && search !== '') ||
      (sortBy !== undefined && sortBy !== '') ||
      (sortOrder !== undefined && sortOrder !== '');

    const result = await this.deploymentService.getDeploymentStatus(req.user.tenantId, {
      uid,
      part_number: partNumber,
      organization,
      location,
      search,
      offset: parsedOffset,
      limit: parsedLimit,
      sort_by: sortBy,
      sort_order: sortOrder,
    });

    // Backward compatible: existing callers expect an array.
    return wantsPagination ? result : result.data;
  }

  @Post()
  @RequireCreate('uid')
  async create(@Request() req: any, @Body() dto: CreateDeploymentDto) {
    return this.deploymentService.createDeployment(
      req.user.tenantId,
      req.user.userId,
      dto,
    );
  }

  @Get()
  async findAll(
    @Request() req: any,
    @Query('uid_id') uidId?: string,
    @Query('organization') organization?: string,
    @Query('deployment_level') deploymentLevel?: string,
    @Query('is_current') isCurrent?: string,
  ) {
    return this.deploymentService.getDeployments(req.user.tenantId, {
      uid_id: uidId,
      organization,
      deployment_level: deploymentLevel,
      is_current: isCurrent === 'true' ? true : isCurrent === 'false' ? false : undefined,
    });
  }

  @Get(':uidId/history')
  async getHistory(@Request() req: any, @Param('uidId') uidId: string) {
    return this.deploymentService.getDeployments(req.user.tenantId, {
      uid_id: uidId,
    });
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.deploymentService.getDeploymentById(req.user.tenantId, id);
  }

  @Get('uid/:uidId/chain')
  async getChain(@Request() req: any, @Param('uidId') uidId: string) {
    return this.deploymentService.getDeploymentChain(req.user.tenantId, uidId);
  }

  @Get('uid/:uidId/current')
  async getCurrentLocation(@Request() req: any, @Param('uidId') uidId: string) {
    return this.deploymentService.getCurrentLocation(req.user.tenantId, uidId);
  }

  @Put(':id')
  @RequireUpdate('uid')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateDeploymentDto,
  ) {
    return this.deploymentService.updateDeployment(req.user.tenantId, req.user.id, id, dto);
  }

  @Post('uid/:uidId/set-current/:deploymentId')
  async setCurrentLocation(
    @Request() req: any,
    @Param('uidId') uidId: string,
    @Param('deploymentId') deploymentId: string,
  ) {
    return this.deploymentService.setCurrentLocation(
      req.user.tenantId,
      uidId,
      deploymentId,
    );
  }

  @Delete(':id')
  @RequireDelete('uid')
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.deploymentService.deleteDeployment(req.user.tenantId, id);
  }
}
