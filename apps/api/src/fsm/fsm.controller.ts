import { Body, Controller, Get, Param, Patch, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequireApprove, RequireCreate, RequireRead, RequireUpdate } from "../auth/decorators/permissions.decorator";
import { FsmService } from "./fsm.service";

@Controller("fsm")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FsmController {
  constructor(private readonly fsm: FsmService) {}

  @Get("capabilities") @RequireRead("fsm") capabilities(@Request() req: any) { return this.fsm.capabilities(req.user); }
  @Get("settings") @RequireRead("fsm") settings(@Request() req: any) { return this.fsm.settings(req.user); }
  @Patch("settings") @RequireUpdate("fsm") updateSettings(@Request() req: any, @Body() body: any) { return this.fsm.updateSettings(req.user, body); }

  @Get("sites") @RequireRead("fsm") sites(@Request() req: any, @Query() query: any) { return this.fsm.sites(req.user, query); }
  @Get("sites/nearby") @RequireRead("fsm") nearby(@Request() req: any, @Query() query: any) { return this.fsm.nearby(req.user, query); }
  @Post("sites") @RequireCreate("fsm") createSite(@Request() req: any, @Body() body: any) { return this.fsm.saveSite(req.user, body); }
  @Patch("sites/:id") @RequireUpdate("fsm") updateSite(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.saveSite(req.user, body, id); }
  @Get("accounts/:id/assignments") @RequireRead("fsm") assignments(@Request() req: any, @Param("id") id: string) { return this.fsm.assignments(req.user, id); }
  @Post("assignments") @RequireUpdate("fsm") createAssignment(@Request() req: any, @Body() body: any) { return this.fsm.saveAssignment(req.user, body); }
  @Post("visit-rules") @RequireUpdate("fsm") createRule(@Request() req: any, @Body() body: any) { return this.fsm.saveRule(req.user, body); }
  @Post("visit-rules/generate") @RequireUpdate("fsm") generate(@Request() req: any, @Body() body: any) { return this.fsm.generateRecurrence(req.user, body); }

  @Get("plans") @RequireRead("fsm") plans(@Request() req: any, @Query() query: any) { return this.fsm.plans(req.user, query); }
  @Post("plans") @RequireCreate("fsm") createPlan(@Request() req: any, @Body() body: any) { return this.fsm.createPlan(req.user, body); }
  @Post("plans/:id/publish") @RequireApprove("fsm") publish(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.publishPlan(req.user, id, body); }
  @Post("plans/:id/revise") @RequireUpdate("fsm") revise(@Request() req: any, @Param("id") id: string) { return this.fsm.revisePlan(req.user, id); }

  @Get("visits") @RequireRead("fsm") visits(@Request() req: any, @Query() query: any) { return this.fsm.visits(req.user, query); }
  @Get("visits/:id") @RequireRead("fsm") visit(@Request() req: any, @Param("id") id: string) { return this.fsm.visitDetail(req.user, id); }
  @Post("visits") @RequireCreate("fsm") createVisit(@Request() req: any, @Body() body: any) { return this.fsm.createVisit(req.user, body); }
  @Post("visits/:id/en-route") @RequireUpdate("fsm") enRoute(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.transition(req.user, id, "EN_ROUTE", body); }
  @Post("visits/:id/check-in") @RequireUpdate("fsm") checkIn(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.transition(req.user, id, "CHECKED_IN", body); }
  @Post("visits/:id/report") @RequireUpdate("fsm") report(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.saveReport(req.user, id, body); }
  @Post("visits/:id/attachments") @RequireUpdate("fsm")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  attachment(@Request() req: any, @Param("id") id: string, @UploadedFile() file: Express.Multer.File) { return this.fsm.uploadAttachment(req.user, id, file); }
  @Get("attachments/:id/url") @RequireRead("fsm") attachmentUrl(@Request() req: any, @Param("id") id: string) { return this.fsm.attachmentUrl(req.user, id); }
  @Post("visits/:id/check-out") @RequireUpdate("fsm") checkOut(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.transition(req.user, id, "COMPLETED", body); }
  @Post("visits/:id/cancel") @RequireUpdate("fsm") cancel(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.transition(req.user, id, "CANCELLED", body); }

  @Get("recommendations") @RequireRead("fsm") recommendations(@Request() req: any) { return this.fsm.recommendations(req.user); }
  @Post("routes/preview") @RequireRead("fsm") route(@Request() req: any, @Body() body: any) { return this.fsm.routePreview(req.user, body); }
  @Get("exceptions") @RequireApprove("fsm") exceptions(@Request() req: any) { return this.fsm.exceptions(req.user); }
  @Post("exceptions/:id/review") @RequireApprove("fsm") review(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.reviewException(req.user, id, body); }

  @Get("visits/:id/commercial") @RequireRead("fsm") commercial(@Request() req: any, @Param("id") id: string) { return this.fsm.commercialContext(req.user, id); }
  @Post("visits/:id/commercial-links") @RequireUpdate("fsm") link(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.linkCommercial(req.user, id, body); }
  @Post("visits/:id/collection-promises") @RequireCreate("fsm") promise(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.collectionPromise(req.user, id, body); }
  @Post("visits/:id/whatsapp-draft") @RequireCreate("fsm") message(@Request() req: any, @Param("id") id: string, @Body() body: any) { return this.fsm.messageDraft(req.user, id, body); }

  @Get("manager/dashboard") @RequireRead("fsm") dashboard(@Request() req: any, @Query() query: any) { return this.fsm.managerDashboard(req.user, query); }
  @Get("sync/package") @RequireRead("fsm") syncPackage(@Request() req: any, @Query("since") since?: string) { return this.fsm.syncPackage(req.user, since); }
  @Post("sync/batch") @RequireUpdate("fsm") sync(@Request() req: any, @Body() body: any) { return this.fsm.syncBatch(req.user, body); }
}
