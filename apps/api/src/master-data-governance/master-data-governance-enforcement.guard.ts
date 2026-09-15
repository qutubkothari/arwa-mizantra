import { CanActivate, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

type ProtectedRoute = { entity: string; methods: string[]; pattern: RegExp };
const PROTECTED: ProtectedRoute[] = [
  {entity:'CUSTOMER',methods:['POST'],pattern:/^\/sales\/customers\/?$/},
  {entity:'CUSTOMER',methods:['PUT','DELETE'],pattern:/^\/sales\/customers\/[0-9a-f-]+\/?$/i},
  {entity:'SUPPLIER',methods:['POST'],pattern:/^\/purchase\/vendors\/?$/},
  {entity:'SUPPLIER',methods:['PUT','DELETE'],pattern:/^\/purchase\/vendors\/[0-9a-f-]+\/?$/i},
  {entity:'ITEM',methods:['POST'],pattern:/^\/items\/?$/},
  {entity:'ITEM',methods:['PUT','DELETE'],pattern:/^\/items\/[0-9a-f-]+\/?$/i},
  {entity:'GL_ACCOUNT',methods:['POST'],pattern:/^\/accounting\/accounts\/?$/},
  {entity:'GL_ACCOUNT',methods:['PATCH'],pattern:/^\/accounting\/accounts\/[0-9a-f-]+\/?$/i},
  {entity:'BANK_ACCOUNT',methods:['POST'],pattern:/^\/accounting\/bank-accounts\/?$/},
  {entity:'BANK_ACCOUNT',methods:['PATCH'],pattern:/^\/accounting\/bank-accounts\/[0-9a-f-]+\/?$/i},
  {entity:'TAX_CODE',methods:['POST'],pattern:/^\/accounting\/tax-codes\/?$/},
];

@Injectable()
export class MasterDataGovernanceEnforcementGuard implements CanActivate {
  private readonly db: SupabaseClient=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_KEY!);
  private readonly cache=new Map<string,{enabled:boolean,expires:number}>();
  async canActivate(context:any):Promise<boolean>{
    const req=context.switchToHttp().getRequest(),method=String(req.method||'').toUpperCase(),path=String(req.originalUrl||req.url||'').split('?')[0].replace(/^\/api\/v1/,'');
    const route=PROTECTED.find(x=>x.methods.includes(method)&&x.pattern.test(path));if(!route)return true;
    const tenantId=req.user?.tenantId;if(!tenantId)return true;
    let cached=this.cache.get(tenantId);if(!cached||cached.expires<Date.now()){
      const {data,error}=await this.db.from('master_data_governance_settings').select('enforcement_enabled').eq('tenant_id',tenantId).maybeSingle();
      if(error)throw new ServiceUnavailableException('Unable to verify master-data governance enforcement.');
      cached={enabled:Boolean(data?.enforcement_enabled),expires:Date.now()+15000};this.cache.set(tenantId,cached);
    }
    if(!cached.enabled)return true;
    const actorId=req.user?.userId||req.user?.id||null,payloadHash=createHash('sha256').update(JSON.stringify(req.body||{})).digest('hex');
    await this.db.from('master_data_bypass_attempts').insert({tenant_id:tenantId,actor_id:actorId,entity_type:route.entity,method,route:path,payload_hash:payloadHash,source_ip:String(req.ip||req.socket?.remoteAddress||'').slice(0,80)||null});
    throw new ConflictException({code:'MASTER_DATA_GOVERNANCE_REQUIRED',entity_type:route.entity,message:`Direct ${route.entity.replace('_',' ').toLowerCase()} changes are disabled. Prepare and approve the change in Master Data Governance.`,governance_path:'/dashboard/settings/master-data-governance'});
  }
}
