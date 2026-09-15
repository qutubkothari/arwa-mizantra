import { Controller, Post, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator';
import { MigrationService } from './migration.service';

@Controller('migrate')
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  @Public()
  @Post('hr-tables')
  async createHRTables() {
    return this.migrationService.createHRTables();
  }

  @Public()
  @Post('bom-routing-table')
  async createBomRoutingTable() {
    return this.migrationService.createBomRoutingTable();
  }

  @Public()
  @Post('subcontracting-tables')
  async createSubcontractingTables() {
    return this.migrationService.createSubcontractingTables();
  }

  @Public()
  @Get('status')
  async getStatus() {
    return { status: 'Migration service ready', timestamp: new Date().toISOString() };
  }
}
