import { Body, Controller, Headers, HttpCode, Param, Post } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { CrmService } from "./crm.service";

@Controller("crm/inbound")
export class CrmInboundController {
  constructor(private readonly crm: CrmService) {}

  @Public()
  @Post(":channelId")
  @HttpCode(200)
  receive(
    @Param("channelId") channelId: string,
    @Headers("x-mizantra-channel-token") token: string | undefined,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: any,
  ) {
    const bearer = String(authorization || "").replace(/^Bearer\s+/i, "");
    return this.crm.receiveInboundChannel(
      channelId,
      String(token || bearer || ""),
      body || {},
    );
  }
}
