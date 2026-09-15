import { Module } from '@nestjs/common';
import { NomenclatureController } from './controllers/nomenclature.controller';
import { NomenclatureService } from './services/nomenclature.service';

@Module({
  controllers: [NomenclatureController],
  providers: [NomenclatureService],
  exports: [NomenclatureService],
})
export class NomenclatureModule {}
