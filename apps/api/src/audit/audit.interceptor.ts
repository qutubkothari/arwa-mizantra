import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { AuditService } from './audit.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 50;
const SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'api_key',
  'secret',
  'clientsecret',
  'gstin_sandbox_api_secret',
]);

type AuditMetadata = {
  resourceType?: string;
  action?: string;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    const method = String(request.method || '').toUpperCase();
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || !MUTATING_METHODS.has(method) || !request.user) {
      return next.handle();
    }

    const startedAt = Date.now();

    return next.handle().pipe(
      mergeMap(async (responseBody: any) => {
        await this.logRequest(context, request, responseBody, startedAt);
        return responseBody;
      }),
      catchError((error: any) =>
        from(this.logRequest(context, request, error?.response || null, startedAt, error)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private async logRequest(
    context: ExecutionContext,
    request: any,
    responseBody: any,
    startedAt: number,
    error?: any,
  ): Promise<void> {
    const user = request.user || {};
    const tenantId = user.tenantId || user.tenant_id;
    const userId = user.userId || user.id;
    if (!tenantId || !userId) return;

    const method = String(request.method || '').toUpperCase();
    const routePath = this.getRoutePath(request);
    const auditMetadata = this.reflector.getAllAndOverride<AuditMetadata>('audit', [
      context.getHandler(),
      context.getClass(),
    ]);

    const resourceType = auditMetadata?.resourceType || this.inferResourceType(routePath);
    const action = error
      ? `FAILED_${auditMetadata?.action || this.inferAction(method, routePath)}`
      : auditMetadata?.action || this.inferAction(method, routePath);

    const responsePayload = this.extractPayload(responseBody);
    const resourceId = this.pickFirstString(
      request.params?.id,
      request.params?.uid,
      request.params?.runId,
      request.params?.docId,
      responsePayload?.id,
      responsePayload?.data?.id,
    );
    const resourceCode = this.pickFirstString(
      responsePayload?.po_number,
      responsePayload?.pr_number,
      responsePayload?.grn_number,
      responsePayload?.so_number,
      responsePayload?.quotation_number,
      responsePayload?.item_code,
      responsePayload?.code,
      responsePayload?.data?.po_number,
      responsePayload?.data?.code,
    );
    const resourceName = this.pickFirstString(
      responsePayload?.name,
      responsePayload?.item_name,
      responsePayload?.title,
      responsePayload?.subject,
      responsePayload?.data?.name,
      resourceCode,
    );

    await this.auditService.logActivity({
      tenantId,
      userId,
      action,
      resourceType,
      resourceId,
      resourceCode,
      resourceName,
      oldValue: null,
      newValue: {
        request: this.sanitize(request.body),
        response: this.sanitize(responsePayload),
      },
      ipAddress: this.getIpAddress(request),
      userAgent: request.headers?.['user-agent'] || null,
      metadata: {
        audit_source: 'AuditInterceptor',
        method,
        path: routePath,
        params: this.sanitize(request.params || {}),
        query: this.sanitize(request.query || {}),
        status_code: error?.status || error?.response?.statusCode || context.switchToHttp().getResponse()?.statusCode || null,
        duration_ms: Date.now() - startedAt,
        controller: context.getClass()?.name,
        handler: context.getHandler()?.name,
        error_message: error?.message || null,
      },
    });
  }

  private getRoutePath(request: any): string {
    return String(request.originalUrl || request.url || request.route?.path || '').split('?')[0];
  }

  private inferAction(method: string, routePath: string): string {
    const normalizedPath = routePath.toLowerCase();
    if (normalizedPath.includes('approve')) return 'APPROVE';
    if (normalizedPath.includes('reject')) return 'REJECT';
    if (normalizedPath.includes('cancel')) return 'CANCEL';
    if (normalizedPath.includes('archive')) return 'ARCHIVE';
    if (normalizedPath.includes('submit')) return 'SUBMIT';
    if (normalizedPath.includes('send')) return 'SEND';
    if (normalizedPath.includes('upload')) return 'UPLOAD';
    if (normalizedPath.includes('import')) return 'IMPORT';
    if (normalizedPath.includes('export')) return 'EXPORT';
    if (normalizedPath.includes('generate')) return 'GENERATE';
    if (normalizedPath.includes('convert')) return 'CONVERT';
    if (normalizedPath.includes('verify')) return 'VERIFY';
    if (normalizedPath.includes('status')) return 'UPDATE_STATUS';
    if (method === 'POST') return 'CREATE';
    if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
    if (method === 'DELETE') return 'DELETE';
    return method;
  }

  private inferResourceType(routePath: string): string {
    const cleanPath = routePath
      .replace(/^\/api\/v\d+\//, '')
      .replace(/^\//, '');
    const parts = cleanPath.split('/').filter(Boolean);
    if (parts[0] === 'purchase' && parts[1]) return `purchase_${this.singularize(parts[1])}`;
    if (parts[0] === 'sales' && parts[1]) return `sales_${this.singularize(parts[1])}`;
    if (parts[0] === 'hr' && parts[1]) return `hr_${this.singularize(parts[1])}`;
    if (parts[0] === 'inventory' && parts[1]) return `inventory_${this.singularize(parts[1])}`;
    if (parts[0] === 'documents' && parts[1] === 'categories') return 'document_category';
    return this.singularize(parts[0] || 'unknown');
  }

  private singularize(value: string): string {
    const normalized = String(value || 'unknown').replace(/-/g, '_');
    if (normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
    if (normalized.endsWith('ses')) return normalized.slice(0, -2);
    if (normalized.endsWith('s') && normalized.length > 1) return normalized.slice(0, -1);
    return normalized;
  }

  private getIpAddress(request: any): string | null {
    const forwardedFor = request.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }
    return request.ip || request.socket?.remoteAddress || null;
  }

  private extractPayload(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (value.data && typeof value.data === 'object') return value.data;
    return value;
  }

  private pickFirstString(...values: any[]): string | null {
    for (const value of values) {
      const normalized = String(value ?? '').trim();
      if (normalized) return normalized;
    }
    return null;
  }

  private sanitize(value: any, depth = 0): any {
    if (value === null || value === undefined) return value;
    if (depth > 5) return '[MAX_DEPTH]';
    if (typeof value === 'string') {
      return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      const result = value.slice(0, MAX_ARRAY_LENGTH).map((entry) => this.sanitize(entry, depth + 1));
      if (value.length > MAX_ARRAY_LENGTH) result.push(`[${value.length - MAX_ARRAY_LENGTH} more items]`);
      return result;
    }
    if (typeof value === 'object') {
      const result: Record<string, any> = {};
      const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
      for (const [key, entry] of entries) {
        const normalizedKey = key.replace(/[_-]/g, '').toLowerCase();
        result[key] = SENSITIVE_KEYS.has(normalizedKey) ? REDACTED : this.sanitize(entry, depth + 1);
      }
      const totalKeys = Object.keys(value).length;
      if (totalKeys > MAX_OBJECT_KEYS) result.__truncated_keys = totalKeys - MAX_OBJECT_KEYS;
      return result;
    }
    return String(value);
  }
}