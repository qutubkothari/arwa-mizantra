import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import {
  RequireApprove,
  RequireUpdate,
} from "../../auth/decorators/permissions.decorator";
import { ProductionStandardizationService } from "../services/production-standardization.service";

@Controller("production-standardization")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductionStandardizationController {
  constructor(private readonly service: ProductionStandardizationService) {}
  private user(req: any) {
    return req.user.userId || req.user.id;
  }

  @Get("overview") overview(@Req() req: any) {
    return this.service.overview(req.user.tenantId);
  }
  @Get("configuration-packs") configurationPacks() {
    return this.service.listConfigurationPacks();
  }
  @Get("configuration-packs/:code") configurationPack(
    @Param("code") code: string,
  ) {
    return this.service.getConfigurationPack(code);
  }
  @Post("configuration-packs/:code/install")
  @RequireUpdate("items")
  installConfigurationPack(@Req() req: any, @Param("code") code: string) {
    return this.service.installConfigurationPack(
      req.user.tenantId,
      this.user(req),
      code,
    );
  }
  @Post("configuration-packs/:code/mappings/validate")
  @RequireUpdate("job_orders")
  validateConfigurationMapping(
    @Req() req: any,
    @Param("code") code: string,
    @Body() body: any,
  ) {
    return this.service.validateConfigurationMapping(
      req.user.tenantId,
      this.user(req),
      code,
      body,
    );
  }
  @Post("configuration-packs/:code/mappings/:id/apply")
  @RequireUpdate("job_orders")
  applyConfigurationMapping(
    @Req() req: any,
    @Param("code") code: string,
    @Param("id") id: string,
  ) {
    return this.service.applyConfigurationMapping(
      req.user.tenantId,
      this.user(req),
      code,
      id,
    );
  }
  @Post("uom-conversions")
  @RequireUpdate("items")
  uomConversion(@Req() req: any, @Body() body: any) {
    return this.service.saveUomConversion(
      req.user.tenantId,
      this.user(req),
      body,
    );
  }
  @Patch("uom-conversions/:id/transition")
  @RequireApprove("items")
  uomConversionTransition(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.transitionUomConversion(
      req.user.tenantId,
      this.user(req),
      id,
      body.action,
    );
  }
  @Get("specifications/search") search(
    @Req() req: any,
    @Query("q") query: string,
  ) {
    return this.service.searchSpecifications(req.user.tenantId, query);
  }
  @Post("attributes")
  @RequireUpdate("items")
  attribute(@Req() req: any, @Body() body: any) {
    return this.service.saveAttribute(req.user.tenantId, this.user(req), body);
  }
  @Patch("attributes/:id/transition")
  @RequireApprove("items")
  attributeTransition(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.transitionAttribute(
      req.user.tenantId,
      this.user(req),
      id,
      body.action,
    );
  }
  @Post("specifications")
  @RequireUpdate("items")
  specification(@Req() req: any, @Body() body: any) {
    return this.service.saveSpecification(
      req.user.tenantId,
      this.user(req),
      body,
    );
  }
  @Patch("specifications/:id/transition")
  @RequireApprove("items")
  specificationTransition(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.transitionSpecification(
      req.user.tenantId,
      this.user(req),
      id,
      body.action,
    );
  }
  @Post("formulas")
  @RequireUpdate("job_orders")
  formula(@Req() req: any, @Body() body: any) {
    return this.service.saveFormula(req.user.tenantId, this.user(req), body);
  }
  @Post("formulas/:id/evaluate")
  evaluate(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.service.testFormula(
      req.user.tenantId,
      this.user(req),
      id,
      body,
    );
  }
  @Post("formulas/:id/run-tests")
  @RequireUpdate("job_orders")
  runTests(@Req() req: any, @Param("id") id: string) {
    return this.service.runFormulaTests(req.user.tenantId, id);
  }
  @Patch("formulas/:id/transition")
  @RequireApprove("job_orders")
  formulaTransition(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.transitionFormula(
      req.user.tenantId,
      this.user(req),
      id,
      body.action,
    );
  }
  @Patch("bom-items/:id/operation-allocation")
  @RequireUpdate("job_orders")
  operationAllocation(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.saveOperationAllocation(req.user.tenantId, id, body);
  }
  @Post("job-cost-statements/:jobId")
  @RequireUpdate("job_orders")
  costStatement(@Req() req: any, @Param("jobId") id: string) {
    return this.service.createCostStatement(
      req.user.tenantId,
      this.user(req),
      id,
    );
  }
  @Post("delivery-allocations")
  @RequireUpdate("job_orders")
  delivery(@Req() req: any, @Body() body: any) {
    return this.service.saveDeliveryAllocation(
      req.user.tenantId,
      this.user(req),
      body,
    );
  }
  @Post("engineering-results")
  @RequireUpdate("job_orders")
  engineering(@Req() req: any, @Body() body: any) {
    return this.service.saveEngineeringResult(
      req.user.tenantId,
      this.user(req),
      body,
    );
  }
  @Patch("engineering-results/:id/transition")
  @RequireApprove("job_orders")
  engineeringTransition(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.transitionEngineeringResult(
      req.user.tenantId,
      this.user(req),
      id,
      body.action,
    );
  }
}
