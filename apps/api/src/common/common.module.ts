import { Module, Global } from '@nestjs/common';
import { DocumentBrandingService } from './services/document-branding.service';
import { DuplicateDetectionService } from './services/duplicate-detection.service';

@Global()
@Module({
  providers: [DuplicateDetectionService, DocumentBrandingService],
  exports: [DuplicateDetectionService, DocumentBrandingService],
})
export class CommonModule {}
