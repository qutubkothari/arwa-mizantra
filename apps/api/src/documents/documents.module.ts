import { Module } from '@nestjs/common';
import { DocumentsService } from './services/documents.service';
import { DocumentCategoriesService } from './services/document-categories.service';
import { DocumentRevisionsService } from './services/document-revisions.service';
import { DocumentApprovalsService } from './services/document-approvals.service';
import { SupabaseStorageService } from './services/supabase-storage.service';
import { OpenAIDocumentService } from './services/openai-document.service';
import { QuotePdfService } from './services/quote-pdf.service';
import { DocumentWorkflowService } from './services/document-workflow.service';
import { DocumentsController } from './controllers/documents.controller';
import { DocumentCategoriesController } from './controllers/document-categories.controller';
import { ClientUploadController } from './controllers/client-upload.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [
    DocumentsController,
    DocumentCategoriesController,
    ClientUploadController,
  ],
  providers: [
    DocumentsService,
    DocumentCategoriesService,
    DocumentRevisionsService,
    DocumentApprovalsService,
    SupabaseStorageService,
    OpenAIDocumentService,
    QuotePdfService,
    DocumentWorkflowService,
  ],
  exports: [
    DocumentsService,
    DocumentCategoriesService,
    DocumentRevisionsService,
    DocumentApprovalsService,
    SupabaseStorageService,
    OpenAIDocumentService,
    QuotePdfService,
    DocumentWorkflowService,
  ],
})
export class DocumentsModule {}
