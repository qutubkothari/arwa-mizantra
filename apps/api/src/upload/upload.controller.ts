import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '../common/storage.service';

@Controller()
export class UploadController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    }),
  )
  async upload(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const bucket = String(body?.bucket || 'drawings').trim() || 'drawings';
    const folder = String(body?.folder || 'uploads').trim() || 'uploads';

    const tenantId = req?.user?.tenantId ? String(req.user.tenantId) : 'public';

    const timestamp = Date.now();
    const safeOriginalName = String(file.originalname || 'file').replace(
      /[^a-zA-Z0-9.-]/g,
      '_',
    );

    const path = `${tenantId}/${folder}/${timestamp}_${safeOriginalName}`;

    const url = await this.storageService.uploadFile(
      bucket,
      path,
      file.buffer,
      file.mimetype,
    );

    return {
      bucket,
      path,
      url,
    };
  }
}
