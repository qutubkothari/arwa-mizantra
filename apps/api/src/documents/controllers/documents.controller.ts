import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentsService } from '../services/documents.service';
import { DocumentRevisionsService } from '../services/document-revisions.service';
import { DocumentWorkflowService } from '../services/document-workflow.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { GenerateQuoteDto } from '../dto/generate-quote.dto';
import { ForwardDocumentDto, RejectDocumentDto, SendToClientDto } from '../dto/workflow.dto';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly revisionsService: DocumentRevisionsService,
    private readonly workflowService: DocumentWorkflowService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    }),
  )
  uploadDocument(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return this.documentsService.uploadAndCreate(req, file, body);
  }

  @Post(':id/revisions/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    }),
  )
  uploadRevision(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return this.documentsService.uploadAndAddRevision(req, id, file, body);
  }

  @Post(':id/reanalyze')
  reanalyzeDocument(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.reanalyze(req, id);
  }

  @Post(':id/quality-check')
  qualityCheck(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.qualityCheck(req, id);
  }

  @Post('generate-quote')
  generateQuote(@Request() req: any, @Body() dto: GenerateQuoteDto) {
    return this.documentsService.generateQuote(req, dto);
  }

  @Get(':id/signed-url')
  getSignedUrl(
    @Request() req: any,
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    return this.documentsService.getSignedUrl(req, id, expiresIn);
  }

  @Post()
  create(@Request() req: any, @Body() createDto: any) {
    return this.documentsService.create(req, createDto);
  }

  @Get()
  findAll(@Request() req: any, @Query() filters: any) {
    return this.documentsService.findAll(req, filters);
  }

  @Get('pending-approvals')
  getPendingApprovals(@Request() req: any) {
    return this.documentsService.getPendingApprovals(req);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.findOne(req, id);
  }

  @Put(':id')
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() updateDto: any,
  ) {
    return this.documentsService.update(req, id, updateDto);
  }

  @Delete(':id')
  delete(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.delete(req, id);
  }

  @Post(':id/revisions')
  addRevision(
    @Request() req: any,
    @Param('id') id: string,
    @Body() revisionDto: any,
  ) {
    return this.documentsService.addRevision(req, id, revisionDto);
  }

  @Get(':id/revisions')
  getRevisions(@Request() req: any, @Param('id') id: string) {
    return this.revisionsService.findAllByDocument(req, id);
  }

  @Post(':id/submit-approval')
  submitForApproval(
    @Request() req: any,
    @Param('id') id: string,
    @Body() approvalWorkflow: any,
  ) {
    return this.documentsService.submitForApproval(req, id, approvalWorkflow);
  }

  @Post(':id/approve/:approvalId')
  approveDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('approvalId') approvalId: string,
    @Body() body: { comments?: string },
  ) {
    return this.documentsService.approveDocument(
      req,
      id,
      approvalId,
      body.comments,
    );
  }

  @Post(':id/reject/:approvalId')
  rejectDocument(
    @Request() req: any,
    @Param('id') id: string,
    @Param('approvalId') approvalId: string,
    @Body() body: { reason: string },
  ) {
    return this.documentsService.rejectDocument(
      req,
      id,
      approvalId,
      body.reason,
    );
  }

  @Post(':id/archive')
  archiveDocument(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.archiveDocument(req, id);
  }

  @Get(':id/access-logs')
  getAccessLogs(@Request() req: any, @Param('id') id: string) {
    return this.documentsService.getAccessLogs(req, id);
  }

  // Workflow endpoints
  @Post(':id/forward-to-staff')
  async forwardToStaff(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ForwardDocumentDto,
  ) {
    return this.workflowService.forwardToStaff(req, id, dto);
  }

  @Post(':id/return-to-admin')
  async returnToAdmin(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { comments?: string },
  ) {
    return this.workflowService.returnToAdmin(req, id, body);
  }

  @Post(':id/forward-to-manager')
  async forwardToManager(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ForwardDocumentDto,
  ) {
    return this.workflowService.forwardToManager(req, id, dto);
  }

  @Post(':id/send-to-client')
  async sendToClient(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: SendToClientDto,
  ) {
    return this.workflowService.sendToClient(req, id, dto);
  }

  @Post(':id/workflow-reject')
  async workflowReject(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: RejectDocumentDto,
  ) {
    return this.workflowService.rejectDocument(req, id, dto);
  }

  @Post(':id/final-approve')
  async finalApprove(@Request() req: any, @Param('id') id: string) {
    return this.workflowService.finalApprove(req, id);
  }

  @Get(':id/workflow-history')
  async getWorkflowHistory(@Request() req: any, @Param('id') id: string) {
    return this.workflowService.getWorkflowHistory(req, id);
  }
}
