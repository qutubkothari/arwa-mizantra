import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MasterDataGovernanceService } from './master-data-governance.service';

@Injectable()
export class MasterDataGovernanceSlaScheduler {
  private readonly logger = new Logger(MasterDataGovernanceSlaScheduler.name);
  private readonly db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  private schemaUnavailable = false;
  constructor(private readonly governance: MasterDataGovernanceService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async evaluateOpenGovernanceSla() {
    // Older tenants can legitimately be running while the optional governance
    // migration is being applied. Do not turn that deployment state into one
    // error per tenant per hour; the feature becomes active automatically once
    // the schema is present and the process is restarted.
    if (this.schemaUnavailable) return;
    const { data, error } = await this.db.from('tenants').select('id');
    if (error) { this.logger.error(`Unable to load SLA tenants: ${error.message}`); return; }
    for (const tenant of data || []) {
      try { await this.governance.evaluateSla(tenant.id, true); }
      catch (error: any) {
        const message = String(error?.message || error);
        if (message.includes("master_data_change_requests") && message.includes("schema cache")) {
          this.schemaUnavailable = true;
          this.logger.warn('Master-data governance SLA evaluation is paused: its database migration has not yet been applied.');
          return;
        }
        this.logger.error(`SLA evaluation failed for ${tenant.id}: ${message}`);
      }
    }
  }
}
