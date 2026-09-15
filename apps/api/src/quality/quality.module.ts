import { Module } from '@nestjs/common';
import { QualityService } from './services/quality.service';
import { QualityController } from './controllers/quality.controller';
import { QualityCapaController } from './controllers/quality-capa.controller';
import { QualityCapaService } from './services/quality-capa.service';
import { EhsSustainabilityController } from './controllers/ehs-sustainability.controller';
import { EhsSustainabilityService } from './services/ehs-sustainability.service';

@Module({
  imports: [],
  controllers: [QualityController, QualityCapaController, EhsSustainabilityController],
  providers: [QualityService, QualityCapaService, EhsSustainabilityService],
  exports: [QualityService],
})
export class QualityModule {}
