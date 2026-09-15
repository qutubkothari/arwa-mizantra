import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ProductionDeviceGatewayService } from '../services/production-device-gateway.service';

@Controller('operational-connectors')
@UseGuards(ThrottlerGuard)
export class OperationalConnectorController {
  constructor(private readonly gateways: ProductionDeviceGatewayService) {}

  @Post('events')
  ingest(
    @Headers('x-mizantra-gateway') gatewayId: string,
    @Headers('x-mizantra-key') apiKey: string,
    @Body() body: any,
  ) {
    return this.gateways.ingestExternal(String(gatewayId || '').trim(), String(apiKey || '').trim(), body || {});
  }
}
