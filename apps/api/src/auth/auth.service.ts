import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import { EmailService } from '../email/email.service';

interface RegisterDto {
  username?: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  name?: string; // Full name from frontend
  companyName?: string; // Company name for new tenant creation
  tenantId?: string; // Optional: for inviting users to existing tenant
  roleId?: string;
}

interface LoginDto {
  username?: string;
  email?: string;
  password: string;
  tenantId?: string;
  accountId?: string;
}

interface LoginTenantOption {
  accountId: string;
  tenantId: string;
  companyName: string;
  displayName?: string;
  username?: string;
  email?: string;
}

@Injectable()
export class AuthService {
  private supabase: SupabaseClient;

  private readonly passwordResetMessage = 'If an account exists for that email, password reset instructions will be sent';

  private normalizeEmail(email: unknown): string {
    return String(email ?? '').trim().toLowerCase();
  }

  private normalizeUsername(username: unknown): string {
    return String(username ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100);
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private isBcryptHash(value: unknown): boolean {
    return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value ?? '').trim());
  }

  private async verifyPassword(candidatePassword: string, storedPassword: unknown): Promise<boolean> {
    const normalizedCandidate = String(candidatePassword ?? '');
    const normalizedStored = String(storedPassword ?? '');

    if (!normalizedCandidate || !normalizedStored) {
      return false;
    }

    if (this.isBcryptHash(normalizedStored)) {
      return bcrypt.compare(normalizedCandidate, normalizedStored);
    }

    return normalizedCandidate === normalizedStored;
  }

  private async buildLoginTenantOptions(users: any[]): Promise<LoginTenantOption[]> {
    const tenantIds = Array.from(
      new Set(
        users
          .map((user) => String(user?.tenant_id || '').trim())
          .filter(Boolean),
      ),
    );

    const tenantNames = new Map<string, string>();
    if (tenantIds.length > 0) {
      const { data } = await this.supabase
        .from('tenants')
        .select('id, name')
        .in('id', tenantIds);

      (data || []).forEach((tenant: any) => {
        tenantNames.set(String(tenant.id), String(tenant.name || '').trim());
      });
    }

    return users.map((user) => {
      const tenantId = String(user.tenant_id);
      const displayName = [user.first_name, user.last_name]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
      return {
        accountId: String(user.id),
        tenantId,
        companyName: tenantNames.get(tenantId) || `Company ${tenantId.slice(0, 8)}`,
        displayName,
        username: user.username,
        email: user.email,
      };
    });
  }

  private async hashPassword(password: string): Promise<string> {
    const normalizedPassword = String(password ?? '');

    if (normalizedPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    return bcrypt.hash(normalizedPassword, 12);
  }

  private getFrontendBaseUrl(): string {
    const configuredFrontendUrl = String(this.configService.get<string>('FRONTEND_URL') || '').trim();
    if (configuredFrontendUrl) {
      return configuredFrontendUrl.replace(/\/+$/, '');
    }

    const configuredCorsOrigins = String(this.configService.get<string>('CORS_ORIGIN') || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => /^https?:\/\//i.test(entry));

    if (configuredCorsOrigins.length > 0) {
      return configuredCorsOrigins[0].replace(/\/+$/, '');
    }

    return 'http://localhost:3000';
  }

  private getFrontendBaseUrlFromRequest(originOrReferer?: string): string {
    const value = String(originOrReferer ?? '').trim();
    if (!value) {
      return this.getFrontendBaseUrl();
    }

    try {
      const parsed = new URL(value);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return this.getFrontendBaseUrl();
    }
  }

  private buildPasswordResetUrl(token: string, originOrReferer?: string): string {
    return `${this.getFrontendBaseUrlFromRequest(originOrReferer)}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private buildPasswordResetEmailHtml(recipientName: string, resetUrl: string): string {
    const safeRecipientName = this.escapeHtml(recipientName);
    const safeResetUrl = this.escapeHtml(resetUrl);

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Reset your password</title>
        </head>
        <body style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#1f2937;">
          <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;">
            <div style="padding:24px 24px 8px;">
              <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:#ede5d8;color:#8b6f47;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Password reset</div>
            </div>
            <div style="padding:0 24px 24px;">
              <h1 style="margin:0 0 16px;color:#6f4e37;font-size:28px;line-height:1.2;">Reset your password</h1>
              <p style="margin:0 0 16px;">Hello ${safeRecipientName},</p>
              <p style="margin:0 0 16px;">We received a request to reset your SAK ERP password. Use the button below to choose a new password.</p>
              <p style="margin:24px 0;">
                <a href="${safeResetUrl}" style="display:inline-block;padding:14px 22px;background:#8b6f47;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Reset password</a>
              </p>
              <p style="margin:0 0 16px;">This link expires in 24 hours. If you did not request a password reset, you can ignore this email.</p>
              <p style="margin:0;color:#6b7280;font-size:13px;word-break:break-all;">If the button does not work, open this link in your browser:<br /><a href="${safeResetUrl}" style="color:#8b6f47;">${safeResetUrl}</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private async sendPasswordResetEmail(user: {
    email: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    tenant_id?: string;
  }, resetToken: string, originOrReferer?: string): Promise<void> {
    const recipientName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
      || user.username
      || user.email.split('@')[0]
      || 'there';

    await this.emailService.sendEmail({
      to: user.email,
      subject: 'Reset your SAK ERP password',
      from: 'noreply',
      tenantId: user.tenant_id,
      html: this.buildPasswordResetEmailHtml(recipientName, this.buildPasswordResetUrl(resetToken, originOrReferer)),
    });
  }

  private async getRolesForUser(
    userId: string,
    tenantId: string,
    legacyRole?: any,
  ): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('user_roles')
        .select(
          `role:roles (
            id,
            name,
            permissions
          )`,
        )
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);

      if (error) {
        // Most common: relation/table not yet created. Fall back to legacy role_id.
        throw error;
      }

      const roles = (data || [])
        .map((row: any) => row?.role)
        .filter(Boolean);

      if (roles.length > 0) {
        return roles;
      }
    } catch {
      // ignore and fall back
    }

    return legacyRole ? [legacyRole] : [];
  }

  private slugifySubdomain(input: string): string {
    const slug = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);

    return slug || `tenant-${Date.now()}`;
  }

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in environment variables');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async register(dto: RegisterDto) {
    const normalizedUsername = this.normalizeUsername(dto?.username || dto?.email?.split('@')[0]);
    const normalizedEmail = this.normalizeEmail(dto?.email);

    if (!normalizedUsername) {
      throw new BadRequestException('Username is required');
    }

    if (!normalizedEmail) {
      throw new BadRequestException('Email is required');
    }

    // MULTI-TENANT SAAS: Create a NEW tenant for each company registration
    let tenantId = dto.tenantId;
    
    if (!tenantId) {
      // NEW BEHAVIOR: Create a new tenant for the company
      if (!dto.companyName) {
        throw new Error('Company name is required for new registrations');
      }

      // Check if company/tenant already exists
      const { data: existingTenant } = await this.supabase
        .from('tenants')
        .select('id, name')
        .eq('name', dto.companyName)
        .eq('is_active', true)
        .maybeSingle();

      if (existingTenant) {
        throw new ConflictException(`Company "${dto.companyName}" already exists. Please contact your administrator for an invitation.`);
      }

      const baseSubdomain = this.slugifySubdomain(dto.companyName);
      let subdomainToUse = baseSubdomain;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { data: existingSubdomain, error: subdomainCheckError } =
          await this.supabase
            .from('tenants')
            .select('id')
            .eq('subdomain', subdomainToUse)
            .maybeSingle();

        if (subdomainCheckError && subdomainCheckError.code !== 'PGRST116') {
          throw new Error(
            `Failed to validate tenant subdomain: ${subdomainCheckError.message}`,
          );
        }

        if (!existingSubdomain) break;

        subdomainToUse = `${baseSubdomain}-${attempt + 2}`.slice(0, 50);
      }

      // Create new tenant for this company
      const { data: newTenant, error: tenantError } = await this.supabase
        .from('tenants')
        .insert({
          name: dto.companyName,
          subdomain: subdomainToUse,
          domain: dto.companyName.toLowerCase().replace(/\s+/g, '-'),
          is_active: true,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (tenantError || !newTenant) {
        throw new Error(`Failed to create tenant: ${tenantError?.message || 'Unknown error'}`);
      }

      tenantId = newTenant.id;
    }

    if (!tenantId) {
      throw new Error('Tenant ID is required but was not set');
    }

    const resolvedTenantId = tenantId;

    const { data: existingUsername } = await this.supabase
      .from('users')
      .select('id')
      .ilike('username', normalizedUsername)
      .eq('tenant_id', resolvedTenantId)
      .maybeSingle();

    if (existingUsername) {
      throw new ConflictException('User with this username already exists');
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await this.supabase
      .from('users')
      .select('id')
      .ilike('email', normalizedEmail)
      .eq('tenant_id', resolvedTenantId)
      .maybeSingle();

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await this.hashPassword(dto.password);

    // Parse name if provided as single field
    let firstName = dto.firstName;
    let lastName = dto.lastName;
    if (!firstName && dto.name) {
      const nameParts = dto.name.split(' ');
      firstName = nameParts[0];
      lastName = nameParts.slice(1).join(' ') || '';
    }

    // Get default role if not provided
    let roleId = dto.roleId;
    if (!roleId) {
      const { data: defaultRole, error: roleError } = await this.supabase
        .from('roles')
        .select('id')
        .eq('tenant_id', resolvedTenantId)
        .eq('name', 'USER')
        .maybeSingle();
      
      if (roleError && roleError.code !== 'PGRST116') {
        throw new Error(`Failed to fetch default role: ${roleError.message}`);
      }
      roleId = defaultRole?.id;
    }

    // Create user
    const { data: newUser, error: createError } = await this.supabase
      .from('users')
      .insert({
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        first_name: firstName || '',
        last_name: lastName || '',
        tenant_id: resolvedTenantId,
        role_id: roleId,
        is_active: true,
      })
      .select('id, username, email, first_name, last_name, tenant_id')
      .single();

    if (createError) {
      throw new Error(`Failed to create user: ${createError.message}`);
    }

    // Best-effort: keep user_roles in sync when multi-role table exists
    if (roleId) {
      try {
        await this.supabase.from('user_roles').insert({
          tenant_id: resolvedTenantId,
          user_id: newUser.id,
          role_id: roleId,
        });
      } catch {
        // ignore if user_roles doesn't exist yet
      }
    }

    // Fetch user with role for response
    const { data: userWithRole, error: fetchError } = await this.supabase
      .from('users')
      .select(`
        id,
        username,
        email,
        first_name,
        last_name,
        role:roles (
          id,
          name,
          permissions
        )
      `)
      .eq('id', newUser.id)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch user details: ${fetchError.message}`);
    }

    const rolesForUser = await this.getRolesForUser(
      userWithRole.id,
      resolvedTenantId,
      (userWithRole as any).role,
    );

    // Transform to match expected format
    const user = {
      id: userWithRole.id,
      username: (userWithRole as any).username,
      email: userWithRole.email,
      firstName: userWithRole.first_name,
      lastName: userWithRole.last_name,
      role: (userWithRole as any).role,
      roles: rolesForUser.map((role: any) => ({ role })),
    };

    // Ensure tenantId is set
    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, (userWithRole as any).username, resolvedTenantId);

    return {
      user,
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const rawLogin = String(dto?.username ?? dto?.email ?? '').trim();
    const normalizedLogin = rawLogin.toLowerCase();

    if (!normalizedLogin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let userQuery = this.supabase
      .from('users')
      .select(`
        id,
        username,
        email,
        password,
        is_active,
        tenant_id,
        first_name,
        last_name,
        role:roles (
          id,
          name,
          permissions
        )
      `);
    userQuery = userQuery.ilike('username', normalizedLogin);
    if (dto.tenantId) userQuery = userQuery.eq('tenant_id', dto.tenantId);
    if (dto.accountId) userQuery = userQuery.eq('id', dto.accountId);

    const { data: candidates, error: userError } = await userQuery.limit(50);
    if (userError || !candidates?.length) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = (
      await Promise.all(
        candidates.map(async (candidate: any) => ({
          candidate,
          valid: await this.verifyPassword(dto.password, candidate.password),
        })),
      )
    ).filter((result) => result.valid).map((result) => result.candidate);

    if (passwordMatches.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const activeMatches = passwordMatches.filter((candidate: any) => candidate.is_active);
    if (activeMatches.length === 0) {
      throw new UnauthorizedException('Account is deactivated');
    }
    if (activeMatches.length > 1) {
      return {
        requiresTenantSelection: true,
        message: 'This login exists in more than one company or user account. Select the correct account to continue.',
        tenants: await this.buildLoginTenantOptions(activeMatches),
      };
    }

    const user = activeMatches[0];
    const resolvedTenantId = user.tenant_id;

    // Update last login
    await this.supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, (user as any).username, resolvedTenantId);

    // Remove password from response and transform to camelCase
    const { password, ...userWithoutPassword } = user;

    const rolesForUser = await this.getRolesForUser(
      user.id,
      resolvedTenantId,
      (user as any).role,
    );

    const transformedUser = {
      ...userWithoutPassword,
      username: (user as any).username,
      firstName: user.first_name,
      lastName: user.last_name,
      tenantId: user.tenant_id,
      isActive: user.is_active,
      roles: rolesForUser.map((role: any) => ({ role })),
    };

    return {
      user: transformedUser,
      ...tokens,
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
      });

      const { data: user, error: userError } = await this.supabase
        .from('users')
        .select('id, username, email, is_active, tenant_id')
        .eq('id', payload.sub)
        .single();

      if (userError || !user || !user.is_active) {
        throw new UnauthorizedException('Invalid token');
      }

      return this.generateTokens(user.id, user.email, (user as any).username, user.tenant_id);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string) {
    // Could implement token blacklist here if needed
    return { message: 'Logged out successfully' };
  }

  async validateUser(userId: string, tenantId: string) {
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .select(`
        id,
        username,
        email,
        first_name,
        last_name,
        is_active,
        tenant_id,
        role:roles (
          id,
          name,
          permissions
        )
      `)
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();

    if (userError || !user) {
      return null;
    }

    const rolesForUser = await this.getRolesForUser(
      user.id,
      tenantId,
      (user as any).role,
    );

    // Transform to camelCase format
    const result = {
      id: user.id,
      username: (user as any).username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      isActive: user.is_active,
      tenantId: user.tenant_id,
      role: (user as any).role,
      roles: rolesForUser.map((role: any) => ({ role })),
    };

    return result;
  }

  private async generateTokens(userId: string, email: string, username: string, tenantId: string) {
    const payload = { sub: userId, email, username, tenantId };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_SECRET || 'default-secret',
        expiresIn: '24h',
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
        expiresIn: '30d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .select('id, password')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await this.verifyPassword(oldPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await this.hashPassword(newPassword);

    const { error: updateError } = await this.supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Failed to update password: ${updateError.message}`);
    }

    return { message: 'Password changed successfully' };
  }

  async resetPasswordRequest(email: string, tenantId?: string, originOrReferer?: string) {
    const identifier = String(email ?? '').trim();
    const normalizedEmail = this.normalizeEmail(identifier);
    const normalizedUsername = this.normalizeUsername(identifier);
    const normalizedTenantId = String(tenantId ?? '').trim();

    if (!identifier) {
      return { message: this.passwordResetMessage };
    }

    const selectActiveUsers = () =>
      this.supabase
        .from('users')
        .select('id, email, username, first_name, last_name, tenant_id')
        .eq('is_active', true);

    const applyTenant = (query: any) => (normalizedTenantId ? query.eq('tenant_id', normalizedTenantId) : query);

    const primaryQuery =
      identifier.includes('@')
        ? applyTenant(selectActiveUsers().ilike('email', normalizedEmail))
        : applyTenant(selectActiveUsers().ilike('username', normalizedUsername || identifier));

    let { data: users, error: userError } = await primaryQuery;

    if ((!users?.length || userError) && !identifier.includes('@') && normalizedEmail) {
      const fallback = await applyTenant(selectActiveUsers().ilike('email', normalizedEmail));
      users = fallback.data;
      userError = fallback.error;
    }

    if (userError || !users?.length) {
      return { message: this.passwordResetMessage };
    }

    for (const user of users) {
      const resetToken = this.jwtService.sign(
        { sub: user.id, email: user.email, tenantId: user.tenant_id, type: 'reset' },
        { expiresIn: '24h' },
      );

      await this.sendPasswordResetEmail(user, resetToken, originOrReferer);
    }

    return { message: this.passwordResetMessage };
  }

  async resetPassword(token: string, newPassword: string) {
    try {
      if (!String(token ?? '').trim()) {
        throw new BadRequestException('Reset token is required');
      }

      const payload = this.jwtService.verify(token);

      if (payload.type !== 'reset' || !payload.sub) {
        throw new UnauthorizedException('Invalid reset token');
      }

      const hashedPassword = await this.hashPassword(newPassword);

      const { error: updateError } = await this.supabase
        .from('users')
        .update({ password: hashedPassword })
        .eq('id', payload.sub);

      if (updateError) {
        throw new Error(`Failed to reset password: ${updateError.message}`);
      }

      return { message: 'Password reset successfully' };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
  }
}
