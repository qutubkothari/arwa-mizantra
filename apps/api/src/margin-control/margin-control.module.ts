import { Module } from '@nestjs/common';
import { MarginControlController } from './margin-control.controller';
import { MarginControlService } from './margin-control.service';

@Module({ controllers: [MarginControlController], providers: [MarginControlService] })
export class MarginControlModule {}
