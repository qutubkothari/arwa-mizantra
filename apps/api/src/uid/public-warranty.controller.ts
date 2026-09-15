import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { PublicDeploymentUpdateDto } from './dto/deployment.dto';

@Controller('public/warranty')
export class PublicWarrantyController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get('search')
  async search(@Query('q') search: string) {
    return this.deploymentService.searchByPartNumberOrUid(search);
  }

  @Get('token/:token')
  async getByToken(@Param('token') token: string) {
    return this.deploymentService.getByPublicToken(token);
  }

  @Post('token/:token/update')
  async updateLocation(
    @Param('token') token: string,
    @Body() dto: PublicDeploymentUpdateDto,
  ) {
    return this.deploymentService.updateViaPublicToken(token, dto);
  }
}
