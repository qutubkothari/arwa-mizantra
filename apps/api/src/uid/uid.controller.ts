import { Controller, Get, Put, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UidService } from './uid.service';
import { UidSupabaseService } from './services/uid-supabase.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdatePartNumberDto } from './dto/deployment.dto';

@ApiTags('UID Tracking')
@Controller('uid')
@UseGuards(JwtAuthGuard)
export class UidController {
  constructor(
    private uidService: UidService,
    private uidSupabaseService: UidSupabaseService,
  ) {}

  @Get('trace/:uid')
  @ApiOperation({ summary: 'Get complete UID traceability report (full details)' })
  async getUidTrace(@Param('uid') uid: string, @Request() req: any) {
    return this.uidSupabaseService.getCompleteTrace(req, uid);
  }

  @Get()
  @ApiOperation({ summary: 'Get all UIDs (filterable for inspections)' })
  async getAllUids(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('item_id') itemId?: string,
    @Query('quality_status') qualityStatus?: string,
    @Query('job_order_id') jobOrderId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    const parsedLimit = limit ? parseInt(limit) : undefined;
    const parsedOffset = offset ? parseInt(offset) : undefined;
    return this.uidSupabaseService.getAllUIDs(
      req, 
      status, 
      entityType, 
      itemId, 
      qualityStatus,
      search,
      parsedLimit,
      parsedOffset,
      sortBy,
      sortOrder,
      jobOrderId,
    );
  }

  @Get(':uid(UID-[A-Za-z0-9-]+)')
  @ApiOperation({ summary: 'Get complete UID details with vendor and item information' })
  async getUidDetails(@Param('uid') uid: string) {
    return this.uidService.getUidDetails(uid);
  }

  @Get(':uid(UID-[A-Za-z0-9-]+)/history')
  @ApiOperation({ summary: 'Get UID traceability history' })
  async getUidHistory(@Param('uid') uid: string) {
    return this.uidService.getUidHistory(uid);
  }

  @Get(':uid(UID-[A-Za-z0-9-]+)/validate')
  @ApiOperation({ summary: 'Validate UID format and checksum' })
  async validateUid(@Param('uid') uid: string) {
    const isValid = this.uidService.validateUid(uid);
    return {
      uid,
      isValid,
      message: isValid ? 'UID is valid' : 'Invalid UID format or checksum',
    };
  }

  @Put(':uid(UID-[A-Za-z0-9-]+)/part-number')
  @ApiOperation({ summary: 'Update client part number for UID' })
  async updatePartNumber(
    @Param('uid') uid: string,
    @Body() dto: UpdatePartNumberDto,
    @Request() req: any,
  ) {
    await this.uidSupabaseService.updatePartNumber(req, uid, dto.client_part_number);
    return {
      message: 'Part number updated successfully',
      uid,
      client_part_number: dto.client_part_number,
    };
  }

  @Get('search/part-number')
  @ApiOperation({ summary: 'Search UIDs by client part number' })
  async searchByPartNumber(@Query('q') partNumber: string) {
    return this.uidService.searchByPartNumber(partNumber);
  }
}
