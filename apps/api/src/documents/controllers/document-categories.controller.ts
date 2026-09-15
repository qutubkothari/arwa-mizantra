import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { DocumentCategoriesService } from '../services/document-categories.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('document-categories')
@UseGuards(JwtAuthGuard)
export class DocumentCategoriesController {
  constructor(
    private readonly categoriesService: DocumentCategoriesService,
  ) {}

  @Post()
  create(@Request() req: any, @Body() createDto: any) {
    return this.categoriesService.create(req, createDto);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.categoriesService.findAll(req);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.categoriesService.findOne(req, id);
  }

  @Put(':id')
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() updateDto: any,
  ) {
    return this.categoriesService.update(req, id, updateDto);
  }

  @Delete(':id')
  delete(@Request() req: any, @Param('id') id: string) {
    return this.categoriesService.delete(req, id);
  }
}
