import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ValueRealizationService } from "./value-realization.service";

@Controller("value-realization")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ValueRealizationController {
  constructor(private readonly service: ValueRealizationService) {}

  @Get("dashboard")
  dashboard(@Req() request: any) {
    return this.service.dashboard(request.user.tenantId);
  }

  @Get("moat-dashboard")
  moatDashboard(@Req() request: any) { return this.service.moatDashboard(request.user.tenantId); }

  @Post("baselines")
  createBaseline(@Req() request: any, @Body() body: any) { return this.service.createBaseline(request.user.tenantId, request.user.userId, body); }
  @Patch("baselines/:id/approve")
  approveBaseline(@Req() request: any, @Param("id") id: string) { return this.service.approveBaseline(request.user.tenantId, request.user.userId, id); }
  @Post("baselines/:id/calculate")
  calculateBaseline(@Req() request:any,@Param("id") id:string,@Body() body:any){return this.service.calculateBaselineOutcome(request.user.tenantId,id,body);}

  @Post("source-benefits/:id/proofs")
  linkProof(@Req() request: any, @Param("id") id: string, @Body() body: any) { return this.service.linkProof(request.user.tenantId, request.user.userId, id, body); }
  @Post("proofs/auto-match")
  autoMatchProofs(@Req() request: any) { return this.service.autoMatchProofs(request.user.tenantId, request.user.userId); }
  @Post("graph-edges/detect-duplicates")
  detectDuplicateValue(@Req() request: any) { return this.service.detectDuplicateValue(request.user.tenantId, request.user.userId); }

  @Post("graph-edges")
  createGraphEdge(@Req() request: any, @Body() body: any) { return this.service.createGraphEdge(request.user.tenantId, request.user.userId, body); }
  @Patch("graph-edges/:id/approve")
  approveGraphEdge(@Req() request: any, @Param("id") id: string) { return this.service.approveGraphEdge(request.user.tenantId, request.user.userId, id); }

  @Post("source-benefits/:id/cadence")
  setCadence(@Req() request: any, @Param("id") id: string, @Body() body: any) { return this.service.setCadence(request.user.tenantId, request.user.userId, id, body); }
  @Patch("cadence/:id/review")
  reviewCadence(@Req() request: any, @Param("id") id: string, @Body() body: any) { return this.service.reviewCadence(request.user.tenantId, request.user.userId, id, body); }

  @Post("commercial-costs")
  createCommercialCost(@Req() request: any, @Body() body: any) { return this.service.createCommercialCost(request.user.tenantId, request.user.userId, body); }
  @Post("country-profile")
  setCountryProfile(@Req() request: any, @Body() body: any) { return this.service.setCountryProfile(request.user.tenantId, request.user.userId, body); }

  @Get("statements/:id/client-pack")
  clientPack(@Req() request: any, @Param("id") id: string) { return this.service.clientPack(request.user.tenantId, id); }
  @Patch("statements/:id/client-approve")
  approveClientPack(@Req() request: any, @Param("id") id: string, @Body() body: any) { return this.service.approveClientPack(request.user.tenantId, request.user.userId, id, body); }
  @Post("client-deliveries")
  scheduleClientDelivery(@Req() request:any,@Body() body:any){return this.service.scheduleClientDelivery(request.user.tenantId,request.user.userId,body);}
  @Post("client-deliveries/process-due")
  processDueDeliveries(@Req() request:any){return this.service.processDueDeliveries(request.user.tenantId);}
  @Post("renewal-profile")
  setRenewalProfile(@Req() request:any,@Body() body:any){return this.service.setRenewalProfile(request.user.tenantId,request.user.userId,body);}
  @Get("renewal-cockpit")
  renewalCockpit(@Req() request:any){return this.service.renewalCockpit(request.user.tenantId);}
  @Post("country-rules/run")
  runCountryRules(@Req() request:any,@Body() body:any){return this.service.runCountryRules(request.user.tenantId,body.period_from,body.period_to);}

  @Post("sync-sources")
  syncSources(@Req() request: any) {
    return this.service.syncSources(request.user.tenantId);
  }

  @Patch("source-benefits/:id/verify")
  verifySourceBenefit(@Req() request: any, @Param("id") id: string, @Body() body: any) {
    return this.service.verifySourceBenefit(request.user.tenantId, request.user.userId, id, body);
  }

  @Patch("source-benefits/:id/reject")
  rejectSourceBenefit(@Req() request: any, @Param("id") id: string, @Body() body: any) {
    return this.service.rejectSourceBenefit(request.user.tenantId, request.user.userId, id, body);
  }

  @Post("overlaps")
  proposeOverlap(@Req() request: any, @Body() body: any) {
    return this.service.proposeOverlap(request.user.tenantId, request.user.userId, body);
  }

  @Patch("overlaps/:id/approve")
  approveOverlap(@Req() request: any, @Param("id") id: string) {
    return this.service.approveOverlap(request.user.tenantId, request.user.userId, id);
  }

  @Post("commercial-profiles")
  createCommercialProfile(@Req() request: any, @Body() body: any) {
    return this.service.createCommercialProfile(request.user.tenantId, request.user.userId, body);
  }

  @Patch("commercial-profiles/:id/approve")
  approveCommercialProfile(@Req() request: any, @Param("id") id: string) {
    return this.service.approveCommercialProfile(request.user.tenantId, request.user.userId, id);
  }

  @Post("statements")
  generateStatement(@Req() request: any, @Body() body: any) {
    return this.service.generateStatement(request.user.tenantId, request.user.userId, body);
  }

  @Patch("statements/:id/issue")
  issueStatement(@Req() request: any, @Param("id") id: string) {
    return this.service.issueStatement(request.user.tenantId, request.user.userId, id);
  }

  @Post("initiatives")
  createInitiative(@Req() request: any, @Body() body: any) {
    return this.service.createInitiative(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Patch("initiatives/:id/approve")
  approveInitiative(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.approveInitiative(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }

  @Patch("initiatives/:id/close")
  closeInitiative(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.closeInitiative(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }

  @Post("claims")
  createClaim(@Req() request: any, @Body() body: any) {
    return this.service.createClaim(
      request.user.tenantId,
      request.user.userId,
      body,
    );
  }

  @Patch("claims/:id/verify")
  verifyClaim(@Req() request: any, @Param("id") id: string, @Body() body: any) {
    return this.service.verifyClaim(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }

  @Patch("claims/:id/reject")
  rejectClaim(@Req() request: any, @Param("id") id: string, @Body() body: any) {
    return this.service.rejectClaim(
      request.user.tenantId,
      request.user.userId,
      id,
      body,
    );
  }
}
