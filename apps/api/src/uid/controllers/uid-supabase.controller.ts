import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UidSupabaseService } from '../services/uid-supabase.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('uid')
@UseGuards(JwtAuthGuard)
export class UidSupabaseController {
  constructor(private readonly uidService: UidSupabaseService) {}

  @Post()
  create(@Request() req: any, @Body() createDto: any) {
    return this.uidService.createUID(req, createDto);
  }

  @Get()
  async findAll(@Request() req: any, @Query() filters: any) {
    try {
      console.log('[UidController] findAll called with filters:', filters);
      
      // Support both itemId and item_id (snake_case from frontend)
      const itemId = filters.itemId || filters.item_id;
      const entityType = filters.entityType || filters.entity_type;
      const qualityStatus = filters.qualityStatus || filters.quality_status;
      const jobOrderId = filters.jobOrderId || filters.job_order_id;
      const search = typeof filters.search === 'string' ? filters.search : undefined;

      const parsedLimit = filters.limit !== undefined ? parseInt(filters.limit, 10) : undefined;
      const parsedOffset = filters.offset !== undefined ? parseInt(filters.offset, 10) : undefined;
      const sortBy = typeof filters.sortBy === 'string' ? filters.sortBy : undefined;
      const sortOrder = filters.sortOrder === 'asc' || filters.sortOrder === 'desc' ? filters.sortOrder : undefined;
      
      console.log('[UidController] Resolved params:', { itemId, status: filters.status, qualityStatus, entityType });
      
      // If requesting with item_id and status (dispatch scenario), use getAllUIDs
      if (itemId && filters.status) {
        console.log('[UidController] Using getAllUIDs for dispatch scenario');
        return await this.uidService.getAllUIDs(
          req,
          filters.status,
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
      
      // If requesting for quality inspection (simple list), use getAllUIDs
      if (filters.forInspection === 'true') {
        console.log('[UidController] Using getAllUIDs for inspection');
        return await this.uidService.getAllUIDs(
          req,
          filters.status,
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

      // If the caller is explicitly using pagination/search/sort, route to getAllUIDs
      // so we don't fall back to the legacy full findAll which may cap results.
      const wantsPagedResponse =
        search !== undefined ||
        parsedLimit !== undefined ||
        parsedOffset !== undefined ||
        sortBy !== undefined ||
        sortOrder !== undefined;

      if (wantsPagedResponse) {
        console.log('[UidController] Using getAllUIDs for paginated/list view');
        return await this.uidService.getAllUIDs(
          req,
          filters.status,
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
      // Otherwise use the full findAll
      console.log('[UidController] Using full findAll');
      return await this.uidService.findAll(req, filters);
    } catch (error) {
      console.error('[UidController] Error in findAll:', error);
      console.error('[UidController] Error stack:', error.stack);
      console.error('[UidController] Error message:', error.message);
      console.error('[UidController] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      // Throw HttpException with detailed message for debugging
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'UID Fetch Failed',
          error: error.message,
          stack: error.stack?.substring(0, 500),
          filters: filters,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('details/:uid')
  getDetails(@Request() req: any, @Param('uid') uid: string) {
    return this.uidService.getUIDDetails(req, uid);
  }

  @Get('search/:uid')
  searchUID(@Request() req: any, @Param('uid') uid: string) {
    return this.uidService.searchUID(req, uid);
  }

  @Get(':uid/hierarchy')
  getHierarchy(@Request() req: any, @Param('uid') uid: string) {
    return this.uidService.getUIDWithHierarchy(req, uid);
  }

  @Get(':uid/purchase-trail')
  getPurchaseTrail(@Request() req: any, @Param('uid') uid: string) {
    return this.uidService.getPurchaseTrail(req, uid);
  }

  @Post(':uid/lifecycle')
  updateLifecycle(
    @Request() req: any,
    @Param('uid') uid: string,
    @Body() body: { stage: string; location: string; reference: string },
  ) {
    return this.uidService.updateLifecycle(
      req,
      uid,
      body.stage,
      body.location,
      body.reference,
    );
  }

  @Post('link')
  linkUIDs(
    @Request() req: any,
    @Body() body: { parentUID: string; childUID: string },
  ) {
    return this.uidService.linkUIDs(req, body.parentUID, body.childUID);
  }

  @Put(':uid/status')
  updateStatus(
    @Request() req: any,
    @Param('uid') uid: string,
    @Body() body: { status: string; location?: string },
  ) {
    return this.uidService.updateStatus(req, uid, body.status, body.location);
  }

  @Put(':uid/quality-status')
  updateQualityStatus(
    @Request() req: any,
    @Param('uid') uid: string,
    @Body()
    body: {
      quality_status?: string;
      qualityStatus?: string;
      notes?: string;
    },
  ) {
    const qualityStatus = (body.quality_status || body.qualityStatus || '').toString();
    return this.uidService.updateQualityStatus(req, uid, qualityStatus, body.notes);
  }

  @Get(':uid/validate')
  validateUID(@Param('uid') uid: string) {
    const isValid = this.uidService.validateUIDFormat(uid);
    return {
      uid,
      isValid,
      message: isValid ? 'UID format is valid' : 'Invalid UID format',
    };
  }

  @Get('trace/:uid')
  getCompleteTrace(@Request() req: any, @Param('uid') uid: string) {
    return this.uidService.getCompleteTrace(req, uid);
  }
}
