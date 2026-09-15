import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { ServiceService } from '../services/service.service';

@Public()
@Controller('service-portal')
export class ServicePortalController {
  constructor(private readonly serviceService: ServiceService) {}

  @Get(':token')
  getTicket(@Param('token') token: string) {
    return this.serviceService.getCustomerPortalTicket(token);
  }

  @Post(':token/updates')
  addUpdate(@Param('token') token: string, @Body() body: any) {
    return this.serviceService.addCustomerPortalUpdate(token, body);
  }
}
