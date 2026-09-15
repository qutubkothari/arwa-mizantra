"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PrismaService", {
    enumerable: true,
    get: function() {
        return PrismaService;
    }
});
const _common = require("@nestjs/common");
const _client = require("@prisma/client");
const _config = require("@nestjs/config");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let PrismaService = class PrismaService extends _client.PrismaClient {
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
   */ async softDelete(model, where) {
        return this[model].update({
            where,
            data: {
                deletedAt: new Date()
            }
        });
    }
    /**
   * Tenant-aware query helper
   */ withTenant(tenantId) {
        return {
            where: {
                tenantId
            }
        };
    }
    constructor(configService){
        super({
            datasources: {
                db: {
                    url: configService.get('DATABASE_URL')
                }
            },
            log: [
                'query',
                'info',
                'warn',
                'error'
            ]
        }), this.configService = configService;
    }
};
PrismaService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _config.ConfigService === "undefined" ? Object : _config.ConfigService
    ])
], PrismaService);

//# sourceMappingURL=prisma.service.js.map