import { Module } from '@nestjs/common'; import { PlantMaintenanceController } from './plant-maintenance.controller'; import { PlantMaintenanceService } from './plant-maintenance.service';
@Module({ controllers: [PlantMaintenanceController], providers: [PlantMaintenanceService], exports: [PlantMaintenanceService] }) export class PlantMaintenanceModule {}
