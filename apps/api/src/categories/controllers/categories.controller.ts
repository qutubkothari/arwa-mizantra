import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CategoriesService } from '../services/categories.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';

@Controller('categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async getCategories(@Request() req: any) {
    return this.categoriesService.findAll(req.user.tenantId);
  }

  @Post()
  async createCategory(@Request() req: any, @Body() body: { name: string }) {
    return this.categoriesService.create(req.user.tenantId, body.name);
  }

  @Post('seed')
  async seedCategories(@Request() req: any) {
    return this.categoriesService.seed(req.user.tenantId);
  }

  @Put(':id')
  async updateCategory(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    return this.categoriesService.update(req.user.tenantId, id, body.name);
  }

  @Delete(':id')
  async deleteCategory(@Request() req: any, @Param('id') id: string) {
    return this.categoriesService.delete(req.user.tenantId, id);
  }
}
