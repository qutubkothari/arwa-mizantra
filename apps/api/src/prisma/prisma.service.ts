import { Injectable, OnModuleInit, OnModuleDestroy, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private configService: ConfigService) {
    super({
      datasources: {
        db: {
          url: configService.get('DATABASE_URL'),
        },
      },
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async onModuleInit() {
    // Uses Supabase connection pooler URL (IPv4-compatible) set in DATABASE_URL env var.
    // Pooler URL format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
    if (this.configService.get('DATABASE_URL')) {
      try {
        await this.$connect();
        console.log('✅ Prisma connected to database');
      } catch (err) {
        console.warn('⚠️ Prisma failed to connect — API will start anyway (Supabase JS client still works)');
        console.warn('   Prisma error:', err?.message ?? err);
      }
    } else {
      console.warn('⚠️ DATABASE_URL not set — Prisma will not connect (Supabase JS client still works)');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Soft delete helper
   */
  async softDelete(model: string, where: any) {
    return (this as any)[model].update({
      where,
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Tenant-aware query helper
   */
  withTenant(tenantId: string) {
    return {
      where: { tenantId },
    };
  }
}
