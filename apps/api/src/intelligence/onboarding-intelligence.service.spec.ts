import { BadRequestException } from '@nestjs/common';
import { OnboardingIntelligenceService } from './onboarding-intelligence.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-anon-key';

describe('OnboardingIntelligenceService input controls', () => {
  const service = new OnboardingIntelligenceService();
  it('rejects unsupported datasets', async () => expect(service.analyse('tenant-a','u1',{dataset_type:'ARBITRARY_TABLE',rows:[{}]})).rejects.toBeInstanceOf(BadRequestException));
  it('rejects an empty batch', async () => expect(service.analyse('tenant-a','u1',{dataset_type:'ITEMS',rows:[]})).rejects.toThrow('1 to 5,000'));
  it('rejects non-object rows', async () => expect(service.analyse('tenant-a','u1',{dataset_type:'ITEMS',rows:['unsafe']})).rejects.toThrow('must be an object'));
});
