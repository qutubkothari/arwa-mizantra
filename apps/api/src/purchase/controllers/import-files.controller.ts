import { Body, Controller, Get, Param, Post, Request, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join, resolve } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';
import { ImportFilesService } from '../services/import-files.service';

const uploadRoot = () => process.env.UPLOAD_ROOT_DIR || resolve(process.cwd(), '..', '..', 'uploads');
const importStorage = diskStorage({
  destination: (req, _file, cb) => { try { const user = (req as any).user; const relative = `import-files/${new Date().toISOString().slice(0,10)}/${user?.tenantId || 'unknown'}`; (req as any).__importRelative = relative; const path = join(uploadRoot(), relative); mkdirSync(path,{recursive:true}); cb(null,path); } catch(e) { cb(e as any,''); } },
  filename: (req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname || '').slice(0,10).toLowerCase()}`),
});

@Controller('purchase/import-files')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ImportFilesController {
  constructor(private readonly service: ImportFilesService) {}
  @Get() list(@Request() req:any) { return this.service.list(req.user.tenantId); }
  @Get('by-vendor/:vendorId') byVendor(@Request() req:any,@Param('vendorId') vendorId:string) { return this.service.relatedByVendor(req.user.tenantId,vendorId); }
  @Get('by-po/:poId') byPo(@Request() req:any,@Param('poId') poId:string) { return this.service.relatedByPo(req.user.tenantId,poId); }
  @Get('by-grn/:grnId') byGrn(@Request() req:any,@Param('grnId') grnId:string) { return this.service.relatedByGrn(req.user.tenantId,grnId); }
  @Get(':id') one(@Request() req:any,@Param('id') id:string) { return this.service.one(req.user.tenantId,id); }
  @Post() @RequireCreate('purchase_orders') create(@Request() req:any,@Body() body:any) { return this.service.create(req.user.tenantId,req.user.userId,body); }
  @Post(':id/costs') @RequireCreate('purchase_orders') cost(@Request() req:any,@Param('id') id:string,@Body() body:any) { return this.service.addCost(req.user.tenantId,id,req.user.userId,body); }
  @Post(':id/documents') @RequireCreate('purchase_orders') document(@Request() req:any,@Param('id') id:string,@Body() body:any) { return this.service.addDocument(req.user.tenantId,id,req.user.userId,body); }
  @Post(':id/documents/upload') @RequireCreate('purchase_orders') @UseInterceptors(FileInterceptor('file',{storage:importStorage,limits:{fileSize:25*1024*1024}}))
  async uploadDocument(@Request() req:any,@Param('id') id:string,@Body() body:any,@UploadedFile() file:Express.Multer.File) { if(!file) throw new BadRequestException('Choose a document to upload.'); return this.service.addDocument(req.user.tenantId,id,req.user.userId,{documentType:body.documentType,fileName:file.originalname,fileUrl:`/uploads/${req.__importRelative}/${file.filename}`,notes:body.notes}); }
  @Post(':id/grns') @RequireCreate('purchase_orders') linkGrn(@Request() req:any,@Param('id') id:string,@Body() body:any) { return this.service.linkGrn(req.user.tenantId,id,req.user.userId,body); }
  @Post(':id/assessment') @RequireUpdate('purchase_orders') assessment(@Request() req:any,@Param('id') id:string,@Body() body:any) { return this.service.updateAssessment(req.user.tenantId,id,req.user.userId,body); }
  @Post(':id/landed-cost/post') @RequireApprove('purchase_orders') postLandedCost(@Request() req:any,@Param('id') id:string) { return this.service.postLandedCost(req.user.tenantId,id,req.user.userId); }
  @Post(':id/payments') @RequireCreate('purchase_orders') payment(@Request() req:any,@Param('id') id:string,@Body() body:any) { return this.service.addPayment(req.user.tenantId,id,req.user.userId,body); }
  @Post(':id/payments/:paymentId/status') @RequireApprove('purchase_orders') paymentStatus(@Request() req:any,@Param('id') id:string,@Param('paymentId') paymentId:string,@Body() body:any) { return this.service.updatePaymentStatus(req.user.tenantId,id,paymentId,req.user.userId,body); }
  @Post(':id/status') @RequireUpdate('purchase_orders') status(@Request() req:any,@Param('id') id:string,@Body() body:any) { return this.service.updateStatus(req.user.tenantId,id,req.user.userId,body.status); }
}
