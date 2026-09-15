import {
  Controller,
  Post,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentWorkflowService } from '../services/document-workflow.service';
import { ClientUploadDto } from '../dto/workflow.dto';

@Controller('client')
export class ClientUploadController {
  constructor(private readonly workflowService: DocumentWorkflowService) {}

  @Post('upload/:token')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
      },
    }),
  )
  async uploadRevision(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ClientUploadDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.workflowService.clientUploadRevision(token, file, dto);
  }
}
