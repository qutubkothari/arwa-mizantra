import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Delete,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import {
  RequireCreate,
  RequireDelete,
  RequireRead,
  RequireUpdate,
} from "../auth/decorators/permissions.decorator";
import { CrmService } from "./crm.service";
import { CrmCommercialService } from "./crm-commercial.service";
import { CrmGrowthService } from "./crm-growth.service";

@Controller("crm")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly commercial: CrmCommercialService,
    private readonly growth: CrmGrowthService,
  ) {}

  @Get("revenue-operations")
  @RequireRead("crm")
  revenueOperations(@Request() req: any, @Query("month") month?: string) {
    return this.growth.workspace(req.user.tenantId, month);
  }

  @Post("territories")
  @RequireUpdate("crm")
  createTerritory(@Request() req: any, @Body() body: any) {
    return this.growth.createTerritory(req.user.tenantId, req.user.userId, body);
  }

  @Post("targets")
  @RequireUpdate("crm")
  saveTarget(@Request() req: any, @Body() body: any) {
    return this.growth.upsertTarget(req.user.tenantId, req.user.userId, body);
  }

  @Post("campaigns")
  @RequireCreate("crm")
  createCampaign(@Request() req: any, @Body() body: any) {
    return this.growth.createCampaign(req.user.tenantId, req.user.userId, body);
  }

  @Post("campaigns/:id/members")
  @RequireUpdate("crm")
  addCampaignMembers(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.growth.addCampaignMembers(req.user.tenantId, id, body);
  }

  @Post("message-templates")
  @RequireCreate("crm")
  createMessageTemplate(@Request() req: any, @Body() body: any) {
    return this.growth.createTemplate(req.user.tenantId, req.user.userId, body);
  }

  @Patch("message-templates/:id/approval")
  @RequireUpdate("crm")
  approveMessageTemplate(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.growth.approveTemplate(req.user.tenantId, id, req.user.userId, body.approved === true);
  }

  @Post("cadences")
  @RequireCreate("crm")
  createCadence(@Request() req: any, @Body() body: any) {
    return this.growth.createCadence(req.user.tenantId, req.user.userId, body);
  }

  @Post("cadences/:id/enroll")
  @RequireUpdate("crm")
  enrollCadence(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.growth.enrollLead(req.user.tenantId, id, req.user.userId, body);
  }

  @Post("workflow-rules")
  @RequireCreate("crm")
  createWorkflowRule(@Request() req: any, @Body() body: any) {
    return this.growth.createWorkflow(req.user.tenantId, req.user.userId, body);
  }

  @Patch("workflow-rules/:id/approval")
  @RequireUpdate("crm")
  approveWorkflowRule(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.growth.approveWorkflow(req.user.tenantId, id, req.user.userId, body.approved === true);
  }

  @Post("communications/email")
  @RequireCreate("crm")
  sendCrmEmail(@Request() req: any, @Body() body: any) {
    return this.growth.sendEmail(req.user.tenantId, req.user.userId, body);
  }

  @Get("accounts/:id/360")
  @RequireRead("crm")
  crmAccount360(@Request() req: any, @Param("id") id: string) {
    return this.growth.account360(req.user.tenantId, id);
  }

  @Get("commercial-workspace")
  @RequireRead("crm")
  commercialWorkspace(@Request() req: any) {
    return this.commercial.workspace(req.user.tenantId);
  }

  @Get("accounts")
  @RequireRead("crm")
  accounts(@Request() req: any, @Query() filters: any) {
    return this.commercial.accounts(req.user.tenantId, filters);
  }

  @Post("accounts")
  @RequireCreate("crm")
  createAccount(@Request() req: any, @Body() body: any) {
    return this.commercial.createAccount(req.user.tenantId, req.user.userId, body);
  }

  @Get("contacts")
  @RequireRead("crm")
  contacts(@Request() req: any, @Query() filters: any) {
    return this.commercial.contacts(req.user.tenantId, filters);
  }

  @Post("contacts")
  @RequireCreate("crm")
  createContact(@Request() req: any, @Body() body: any) {
    return this.commercial.createContact(req.user.tenantId, req.user.userId, body);
  }

  @Get("opportunities")
  @RequireRead("crm")
  opportunities(@Request() req: any, @Query() filters: any) {
    return this.commercial.opportunities(req.user.tenantId, filters);
  }

  @Post("opportunities")
  @RequireCreate("crm")
  createOpportunity(@Request() req: any, @Body() body: any) {
    return this.commercial.createOpportunity(req.user.tenantId, req.user.userId, body);
  }

  @Patch("opportunities/:id")
  @RequireUpdate("crm")
  updateOpportunity(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.commercial.updateOpportunity(req.user.tenantId, id, body);
  }

  @Get("dashboard")
  @RequireRead("crm")
  dashboard(@Request() req: any) {
    return this.crm.dashboard(req.user.tenantId, req.user.userId);
  }

  @Get("metadata")
  @RequireRead("crm")
  metadata(@Request() req: any) {
    return this.crm.metadata(req.user.tenantId);
  }

  @Get("intake/settings")
  @RequireRead("crm")
  intakeSettings(@Request() req: any) {
    return this.crm.intakeSettings(req.user.tenantId);
  }

  @Patch("intake/settings")
  @RequireUpdate("crm")
  updateIntakeSettings(@Request() req: any, @Body() body: any) {
    return this.crm.updateIntakeSettings(req.user.tenantId, req.user.userId, body);
  }

  @Get("intake/messages")
  @RequireRead("crm")
  intakeMessages(@Request() req: any, @Query() filters: any) {
    return this.crm.intakeMessages(req.user.tenantId, filters);
  }

  @Post("intake/messages/:id/review")
  @RequireUpdate("crm")
  reviewIntake(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.reviewIntakeMessage(req.user.tenantId, id, req.user.userId, body);
  }

  @Get("sales-pool")
  @RequireRead("crm")
  salesPool(@Request() req: any) {
    return this.crm.salesPool(req.user.tenantId);
  }

  @Patch("sales-pool")
  @RequireUpdate("crm")
  updateSalesPool(@Request() req: any, @Body() body: any) {
    return this.crm.updateSalesPool(req.user.tenantId, req.user.userId, body);
  }

  @Get("email-receipt-routes")
  @RequireRead("crm")
  emailReceiptRoutes(@Request() req: any) {
    return this.crm.emailReceiptRoutes(req.user.tenantId);
  }

  @Post("email-receipt-routes")
  @RequireUpdate("crm")
  createEmailReceiptRoute(@Request() req: any, @Body() body: any) {
    return this.crm.createEmailReceiptRoute(req.user.tenantId, req.user.userId, body);
  }

  @Patch("email-receipt-routes/:id")
  @RequireUpdate("crm")
  updateEmailReceiptRoute(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.updateEmailReceiptRoute(req.user.tenantId, id, body);
  }

  @Get("leads")
  @RequireRead("crm")
  leads(@Request() req: any, @Query() filters: any) {
    return this.crm.leads(req.user.tenantId, filters);
  }

  @Get("leads/:id")
  @RequireRead("crm")
  lead(@Request() req: any, @Param("id") id: string) {
    return this.crm.lead(req.user.tenantId, id);
  }

  @Post("leads")
  @RequireCreate("crm")
  createLead(@Request() req: any, @Body() body: any) {
    return this.crm.createLead(req.user.tenantId, req.user.userId, body);
  }

  @Post("leads/inbound")
  @RequireCreate("crm")
  captureInbound(@Request() req: any, @Body() body: any) {
    return this.crm.captureInboundLead(
      req.user.tenantId,
      req.user.userId,
      body,
    );
  }

  @Post("leads/import")
  @RequireCreate("crm")
  importLeads(@Request() req: any, @Body() body: any) {
    return this.crm.importLeads(req.user.tenantId, req.user.userId, body);
  }

  @Post("leads/bulk-delete")
  @RequireDelete("crm")
  bulkDeleteLeads(@Request() req: any, @Body() body: any) {
    return this.crm.bulkDeleteLeads(req.user.tenantId, req.user.userId, body);
  }

  @Post("intake/messages/bulk-delete")
  @RequireDelete("crm")
  bulkDeleteIntakeMessages(@Request() req: any, @Body() body: any) {
    return this.crm.bulkDeleteIntakeMessages(req.user.tenantId, req.user.userId, body);
  }

  @Patch("leads/:id")
  @RequireUpdate("crm")
  updateLead(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.updateLead(req.user.tenantId, id, body);
  }

  @Post("leads/:id/assign")
  @RequireUpdate("crm")
  assignLead(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.assignLead(
      req.user.tenantId,
      id,
      body.owner_user_id,
      req.user.userId,
      body.reason,
    );
  }

  @Post("leads/:id/stage")
  @RequireUpdate("crm")
  changeStage(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.changeStage(
      req.user.tenantId,
      id,
      body.stage_id,
      req.user.userId,
      body.reason,
    );
  }

  @Post("leads/:id/activities")
  @RequireCreate("crm")
  addActivity(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.addActivity(req.user.tenantId, id, req.user.userId, body);
  }

  @Patch("activities/:id/complete")
  @RequireUpdate("crm")
  completeActivity(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.crm.completeActivity(req.user.tenantId, id, body);
  }

  @Post("leads/:id/convert")
  @RequireCreate("crm")
  convertLead(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.convertLead(req, id, body);
  }

  @Post("leads/:id/merge")
  @RequireUpdate("crm")
  mergeLead(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.mergeLeads(
      req.user.tenantId,
      id,
      body.target_lead_id,
      req.user.userId,
      body.reason,
    );
  }

  @Get("notifications")
  @RequireRead("crm")
  notifications(@Request() req: any) {
    return this.crm.notifications(req.user.tenantId, req.user.userId);
  }

  @Patch("notifications/:id/resolve")
  @RequireUpdate("crm")
  resolveNotification(@Request() req: any, @Param("id") id: string) {
    return this.crm.resolveNotification(req.user.tenantId, id, req.user.userId);
  }

  @Get("customers/:id/360")
  @RequireRead("crm")
  customer360(@Request() req: any, @Param("id") id: string) {
    return this.crm.customer360(req.user.tenantId, id);
  }

  @Post("assignment-rules")
  @RequireUpdate("crm")
  createRule(@Request() req: any, @Body() body: any) {
    return this.crm.createAssignmentRule(
      req.user.tenantId,
      req.user.userId,
      body,
    );
  }

  @Get("inbound-channels")
  @RequireRead("crm")
  inboundChannels(@Request() req: any) {
    return this.crm.inboundChannels(req.user.tenantId);
  }

  @Post("inbound-channels")
  @RequireUpdate("crm")
  createInboundChannel(@Request() req: any, @Body() body: any) {
    return this.crm.createInboundChannel(
      req.user.tenantId,
      req.user.userId,
      body || {},
    );
  }

  @Post("inbound-channels/:id/rotate-token")
  @RequireUpdate("crm")
  rotateInboundChannel(@Request() req: any, @Param("id") id: string) {
    return this.crm.rotateInboundChannelToken(req.user.tenantId, id);
  }

  @Delete("inbound-channels/:id")
  @RequireUpdate("crm")
  deactivateInboundChannel(@Request() req: any, @Param("id") id: string) {
    return this.crm.deactivateInboundChannel(req.user.tenantId, id);
  }

  @Patch("assignment-rules/:id")
  @RequireUpdate("crm")
  updateRule(@Request() req: any, @Param("id") id: string, @Body() body: any) {
    return this.crm.updateAssignmentRule(req.user.tenantId, id, body);
  }
}
