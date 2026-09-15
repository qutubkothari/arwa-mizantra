import { Module } from '@nestjs/common';
import { StorageModule } from '../common/storage.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [StorageModule],
  controllers: [UploadController],
})
export class UploadModule {}
