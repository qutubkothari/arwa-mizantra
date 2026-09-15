import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireCreate, RequireUpdate, RequireDelete } from '../../auth/decorators/permissions.decorator';
import { NomenclatureService } from '../services/nomenclature.service';

@Controller('nomenclature')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NomenclatureController {
  constructor(private readonly nomenclatureService: NomenclatureService) {}

  // Get all nomenclature data (tree structure)
  @Get()
  async getAll(@Request() req: any) {
    return this.nomenclatureService.findAll(req.user.tenantId);
  }

  // Get single primary with secondaries
  @Get(':id')
  async getOne(@Request() req: any, @Param('id') id: string) {
    return this.nomenclatureService.findOne(req.user.tenantId, id);
  }

  // Create primary category
  @Post()
  @RequireCreate('items')
  async createPrimary(
    @Request() req: any,
    @Body() body: {
      label: string;
      acronym: string;
      hint?: string;
      sort_order?: number;
    },
  ) {
    return this.nomenclatureService.createPrimary(req.user.tenantId, body);
  }

  // Update primary category
  @Put(':id')
  @RequireUpdate('items')
  async updatePrimary(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      label?: string;
      acronym?: string;
      hint?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.nomenclatureService.updatePrimary(req.user.tenantId, id, body);
  }

  // Delete primary category
  @Delete(':id')
  @RequireDelete('items')
  async deletePrimary(@Request() req: any, @Param('id') id: string) {
    return this.nomenclatureService.deletePrimary(req.user.tenantId, id);
  }

  // Create secondary category
  @Post('secondary')
  @RequireCreate('items')
  async createSecondary(
    @Request() req: any,
    @Body() body: {
      primary_id: string;
      label: string;
      acronym: string;
      hint?: string;
      sort_order?: number;
    },
  ) {
    return this.nomenclatureService.createSecondary(req.user.tenantId, body);
  }

  // Update secondary category
  @Put('secondary/:id')
  @RequireUpdate('items')
  async updateSecondary(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      label?: string;
      acronym?: string;
      hint?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ) {
    return this.nomenclatureService.updateSecondary(req.user.tenantId, id, body);
  }

  // Delete secondary category
  @Delete('secondary/:id')
  @RequireDelete('items')
  async deleteSecondary(@Request() req: any, @Param('id') id: string) {
    return this.nomenclatureService.deleteSecondary(req.user.tenantId, id);
  }

  // Seed default data
  @Post('seed')
  @RequireCreate('items')
  async seed(@Request() req: any) {
    return this.nomenclatureService.seed(req.user.tenantId);
  }
}
