import { Module } from '@nestjs/common';
import { BomController } from './controllers/bom.controller';
import { BomService } from './services/bom.service';

@Module({
  controllers: [BomController],
  providers: [BomService],
  exports: [BomService],
})
export class BomModule {}
