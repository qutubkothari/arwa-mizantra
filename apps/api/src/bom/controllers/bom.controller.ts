import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { BomService } from "../services/bom.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import {
  RequireDelete,
  RequireCreate,
  RequireUpdate,
} from "../../auth/decorators/permissions.decorator";

@Controller("bom")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BomController {
  constructor(private readonly bomService: BomService) {}

  private hasBomEditRole(user: any): boolean {
    const normalize = (value: unknown) =>
      String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_")
        .replace(/[^A-Z0-9_]/g, "");

    const allowedRoles = new Set(["ADMIN", "SUPER_ADMIN"]);
    const roleNames: string[] = [];

    if (typeof user?.role === "string") {
      roleNames.push(user.role);
    }

    if (user?.role && typeof user.role === "object") {
      roleNames.push(user.role.name);
    }

    if (Array.isArray(user?.roles)) {
      for (const entry of user.roles) {
        const roleObj = entry?.role || entry;
        roleNames.push(roleObj?.name);
      }
    }

    return roleNames
      .map((roleName) => normalize(roleName))
      .some((roleName) => allowedRoles.has(roleName));
  }

  @Post()
  @RequireCreate("bom")
  async create(@Request() req: any, @Body() body: any) {
    return this.bomService.create(req.user.tenantId, req.user.userId, body);
  }

  @Post(":id/submit")
  @RequireUpdate("bom")
  async submit(@Request() req: any, @Param("id") id: string) {
    return this.bomService.submit(req.user.tenantId, req.user.userId, id);
  }

  @Post(":id/approve")
  @RequireUpdate("bom")
  async approve(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: { approvalNote?: string },
  ) {
    return this.bomService.approve(
      req.user.tenantId,
      req.user.userId,
      id,
      body?.approvalNote,
    );
  }

  @Post(":id/retire")
  @RequireUpdate("bom")
  async retire(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: { retirementNote?: string },
  ) {
    return this.bomService.retire(
      req.user.tenantId,
      req.user.userId,
      id,
      body?.retirementNote,
    );
  }

  @Get()
  async findAll(@Request() req: any, @Query() query: any) {
    console.log("[BomController] findAll called:", {
      tenantId: req.user.tenantId,
      query,
    });
    try {
      const result = await this.bomService.findAll(req.user.tenantId, query);
      console.log("[BomController] findAll success:", {
        count: result?.length,
      });
      return result;
    } catch (error) {
      console.error("[BomController] findAll error:", error);
      throw error;
    }
  }

  @Get(":id/items")
  async getBomItems(@Request() req: any, @Param("id") id: string) {
    console.log("[BomController] getBomItems called:", {
      tenantId: req.user.tenantId,
      bomId: id,
    });
    return this.bomService.getBomItems(req.user.tenantId, id);
  }

  @Get(":id")
  async findOne(@Request() req: any, @Param("id") id: string) {
    return this.bomService.findOne(req.user.tenantId, id);
  }

  @Put(":id")
  @RequireUpdate("bom")
  async update(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    if (!this.hasBomEditRole(req.user)) {
      throw new ForbiddenException("Only Admin and Super Admin can edit BOM.");
    }
    return this.bomService.update(req.user.tenantId, req.user.userId, id, body);
  }

  @Post(":id/generate-pr")
  async generatePR(
    @Request() req: any,
    @Param("id") id: string,
    @Body() body: { quantity: number },
  ) {
    return this.bomService.generatePurchaseRequisition(
      req.user.tenantId,
      req.user.userId,
      id,
      body.quantity,
    );
  }

  @Delete(":id")
  @RequireDelete("bom")
  async delete(@Request() req: any, @Param("id") id: string) {
    return this.bomService.delete(req.user.tenantId, id);
  }
}
