import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { ProductionReportService } from "../services/production-report.service";

@Controller("production-reports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionReportController {
  constructor(private readonly reports: ProductionReportService) {}

  @Get("summary")
  summary(@Req() request: any, @Query() query: any) {
    return this.reports.report(request.user.tenantId, query);
  }
}
