import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

@Controller('uae-compliance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UaeComplianceController {
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  @Get('profile') async profile(@Req() r:any){const{data,error}=await this.db.from('uae_tax_compliance_profiles').select('*').eq('tenant_id',r.user.tenantId).maybeSingle();if(error)throw new BadRequestException(error.message);return data||null;}
  @Post('profile') async saveProfile(@Req()r:any,@Body()b:any){const retention=Math.max(5,Number(b.record_retention_years||5));const{data,error}=await this.db.from('uae_tax_compliance_profiles').upsert({tenant_id:r.user.tenantId,trn:String(b.trn||'').trim()||null,corporate_tax_registration_number:String(b.corporate_tax_registration_number||'').trim()||null,tax_period_reference:String(b.tax_period_reference||'').trim()||null,record_retention_years:retention,annual_revenue_band:String(b.annual_revenue_band||'').trim()||null,asp_name:String(b.asp_name||'').trim()||null,peppol_participant_id:String(b.peppol_participant_id||'').trim()||null,mandatory_go_live_date:b.mandatory_go_live_date||null,updated_at:new Date().toISOString()},{onConflict:'tenant_id'}).select().single();if(error)throw new BadRequestException(error.message);return data;}
  @Get('evidence') async evidence(@Req()r:any){const{data,error}=await this.db.from('uae_tax_evidence_register').select('*').eq('tenant_id',r.user.tenantId).order('created_at',{ascending:false});if(error)throw new BadRequestException(error.message);return data||[];}
  @Post('evidence') async add(@Req()r:any,@Body()b:any){if(!b.evidence_type||!String(b.reference_number||'').trim())throw new BadRequestException('Evidence type and reference are required.');const{data,error}=await this.db.from('uae_tax_evidence_register').insert({tenant_id:r.user.tenantId,evidence_type:b.evidence_type,reference_number:String(b.reference_number).trim(),period_from:b.period_from||null,period_to:b.period_to||null,storage_reference:b.storage_reference||null}).select().single();if(error)throw new BadRequestException(error.message);return data;}
  @Patch('evidence/:id') async review(@Req()r:any,@Param('id')id:string,@Body()b:any){const status=String(b.status||'').toUpperCase();if(!['DRAFT','REVIEWED','APPROVED','FILED'].includes(status))throw new BadRequestException('Invalid evidence status.');const patch:any={status};if(status==='REVIEWED'||status==='APPROVED'){patch.reviewed_by=r.user.userId;patch.reviewed_at=new Date().toISOString();}const{data,error}=await this.db.from('uae_tax_evidence_register').update(patch).eq('tenant_id',r.user.tenantId).eq('id',id).select().maybeSingle();if(error||!data)throw new BadRequestException(error?.message||'Evidence record not found.');return data;}
  @Get('einvoices') async einvoices(@Req()r:any){const{data,error}=await this.db.from('uae_einvoice_documents').select('*').eq('tenant_id',r.user.tenantId).order('created_at',{ascending:false});if(error)throw new BadRequestException(error.message);return data||[];}
  @Post('einvoices/prepare/:invoiceId') async prepare(@Req()r:any,@Param('invoiceId')invoiceId:string,@Body()b:any){
    const tenantId=r.user.tenantId;
    const [{data:profile,error:profileError},{data:invoice,error:invoiceError}]=await Promise.all([
      this.db.from('uae_tax_compliance_profiles').select('*').eq('tenant_id',tenantId).maybeSingle(),
      this.db.from('invoices').select('*,customer:customers(*),items:sales_invoice_items(*)').eq('tenant_id',tenantId).eq('id',invoiceId).maybeSingle(),
    ]);
    if(profileError)throw new BadRequestException(profileError.message);if(invoiceError||!invoice)throw new BadRequestException(invoiceError?.message||'Sales invoice not found.');
    const customer:any=(invoice as any).customer||{};const lines:any[]=Array.isArray((invoice as any).items)?(invoice as any).items:[];const errors:string[]=[];
    if(!profile?.trn)errors.push('Seller UAE VAT TRN is missing.');if(!profile?.peppol_participant_id)errors.push('Seller Peppol participant ID is missing.');
    if(!invoice.invoice_number)errors.push('Invoice number is missing.');if(!invoice.invoice_date)errors.push('Invoice date is missing.');if(!customer.customer_name)errors.push('Buyer legal name is missing.');if(!lines.length)errors.push('Invoice lines are missing.');
    const payload={specification:'PINT_AE_READINESS_V1',scope:String(b.transaction_scope||'B2B').toUpperCase(),document:{number:invoice.invoice_number,date:invoice.invoice_date,currency:invoice.currency_code||'AED'},supplier:{trn:profile?.trn||null,peppol_id:profile?.peppol_participant_id||null},buyer:{name:customer.customer_name||null,trn:customer.trn||customer.tax_registration_number||null,email:customer.email||null},totals:{taxable:Number(invoice.taxable_amount||0),tax:Number(invoice.tax_amount||0),payable:Number(invoice.net_amount||0)},lines:lines.map((line:any,index:number)=>({line:index+1,item_id:line.item_id||null,description:line.item_description||line.description||null,quantity:Number(line.quantity||0),unit_price:Number(line.unit_price||0),taxable:Number(line.taxable_amount||0),tax:Number(line.tax_amount||0)})),prepared_at:new Date().toISOString()};
    const serialized=JSON.stringify(payload);const hash=createHash('sha256').update(serialized).digest('hex');const status=errors.length?'DRAFT':'READY';
    const{data,error}=await this.db.from('uae_einvoice_documents').upsert({tenant_id:tenantId,source_type:'SALES_INVOICE',source_id:invoice.id,source_number:invoice.invoice_number,transaction_scope:payload.scope,document_type:'TAX_INVOICE',status,structured_payload:payload,validation_errors:errors,payload_hash:hash,prepared_by:r.user.userId,prepared_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'tenant_id,source_type,source_id'}).select().single();
    if(error)throw new BadRequestException(error.message);return data;
  }
}
