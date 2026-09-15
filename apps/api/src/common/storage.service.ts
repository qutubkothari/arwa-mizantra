import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class StorageService {
  private supabase: SupabaseClient | null = null;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL', '');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_SERVICE_KEY', '') ||
      this.configService.get<string>('SUPABASE_KEY', '');
    
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      this.isConfigured = true;
    }
  }

  private async ensureBucketExists(bucket: string): Promise<void> {
    if (!this.isConfigured || !this.supabase) return;

    const name = String(bucket || '').trim();
    if (!name) return;

    const { error } = await this.supabase.storage.createBucket(name, {
      public: true,
    });

    // Ignore "already exists" style errors; we only care that the bucket is usable.
    if (error && !/exist/i.test(error.message)) {
      throw error;
    }
  }

  async uploadFile(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.isConfigured || !this.supabase) {
      throw new Error(
        'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY).',
      );
    }
    
    // Best-effort: ensure bucket exists (handles fresh environments)
    await this.ensureBucketExists(bucket);

    const attemptUpload = async () =>
      this.supabase!.storage.from(bucket).upload(path, buffer, {
        contentType,
        upsert: true,
      });

    let { error } = await attemptUpload();

    // If the bucket didn't exist (or was deleted), create and retry once.
    if (error && /bucket not found/i.test(error.message)) {
      await this.ensureBucketExists(bucket);
      const retry = await attemptUpload();
      error = retry.error;
    }

    if (error) throw error;

    const { data: urlData } = this.supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return urlData.publicUrl;
  }

  async downloadFile(bucket: string, path: string): Promise<Buffer> {
    if (!this.isConfigured || !this.supabase) {
      throw new Error(
        'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY).',
      );
    }
    
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .download(path);

    if (error) throw error;

    return Buffer.from(await data.arrayBuffer());
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    if (!this.isConfigured || !this.supabase) {
      throw new Error(
        'Supabase storage is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY).',
      );
    }
    
    const { error } = await this.supabase.storage
      .from(bucket)
      .remove([path]);

    if (error) throw error;
  }
}
