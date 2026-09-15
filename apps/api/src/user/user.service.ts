import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService {
  private supabase: SupabaseClient;

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

  private isMissingColumnError(error: unknown, columnName: string): boolean {
    const message = error && typeof error === 'object' && 'message' in error
      ? String((error as any).message)
      : String(error ?? '');

    const lower = message.toLowerCase();
    const column = columnName.toLowerCase();

    return lower.includes('does not exist') && lower.includes(column);
  }

  private splitName(firstName?: string, lastName?: string, employeeName?: string) {
    const trimmedFirst = String(firstName ?? '').trim();
    const trimmedLast = String(lastName ?? '').trim();

    if (trimmedFirst || trimmedLast) {
      return { firstName: trimmedFirst, lastName: trimmedLast };
    }

    const fallback = String(employeeName ?? '').trim();
    if (!fallback) {
      return { firstName: '', lastName: '' };
    }

    const parts = fallback.split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' '),
    };
  }

  private buildEmployeeName(firstName?: string, lastName?: string, employeeName?: string) {
    const explicitName = String(employeeName ?? '').trim();
    if (explicitName) return explicitName;

    const fullName = [String(firstName ?? '').trim(), String(lastName ?? '').trim()]
      .filter(Boolean)
      .join(' ')
      .trim();

    return fullName;
  }

  private normalizeRequiredEmail(email: unknown) {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      throw new ConflictException('Email is required');
    }

    return normalizedEmail;
  }

  private async tryLoadEmployeeLinks(tenantId: string, users: any[]) {
    const map = new Map<string, any>();
    if (!Array.isArray(users) || users.length === 0) return map;

    const userIds = users.map((u: any) => String(u?.id || '')).filter(Boolean);

    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('id, tenant_id, user_id, employee_code, employee_name, designation, department, contact_number, email, status, date_of_joining, date_of_birth, address, biometric_id')
        .eq('tenant_id', tenantId)
        .in('user_id', userIds);

      if (error) throw error;

      for (const row of data || []) {
        if ((row as any)?.user_id) {
          map.set(String((row as any).user_id), row);
        }
      }

      return map;
    } catch (error) {
      return map;
    }
  }

  private async findExistingEmployeeForSync(
    tenantId: string,
    userId: string,
    employeeCode?: string,
  ) {
    const normalizedEmployeeCode = String(employeeCode || '').trim();

    try {
      const { data, error } = await this.supabase
        .from('employees')
        .select('id, employee_code')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      if (data?.id) return data;
    } catch {
      // Ignore and continue with code-based lookup.
    }

    if (!normalizedEmployeeCode) {
      return null;
    }

    try {
      const { data: byCode, error: byCodeError } = await this.supabase
        .from('employees')
        .select('id, employee_code')
        .eq('tenant_id', tenantId)
        .eq('employee_code', normalizedEmployeeCode)
        .maybeSingle();

      if (byCodeError) throw byCodeError;
      return byCode || null;
    } catch {
      // If lookup by code also fails, return null so syncEmployeeProfile falls through to insert
      return null;
    }
  }

  private async syncEmployeeProfile(
    tenantId: string,
    user: {
      id: string;
      email: string;
      first_name?: string;
      last_name?: string;
      is_active?: boolean;
    },
    dto: {
      employee_code?: string;
      employee_name?: string;
      designation?: string;
      department?: string;
      date_of_joining?: string;
      date_of_birth?: string;
      contact_number?: string;
      address?: string;
      biometric_id?: string;
    },
  ) {
    const employeeName = this.buildEmployeeName(user.first_name, user.last_name, dto.employee_name);
    const fallbackEmployeeCode = `EMP-${String(Date.now()).slice(-8)}`;
    const normalizedEmployeeCode = String(dto.employee_code || '').trim() || fallbackEmployeeCode;

    const employeePayload: any = {
      tenant_id: tenantId,
      user_id: user.id,
      employee_code: normalizedEmployeeCode,
      employee_name: employeeName,
      designation: dto.designation || null,
      department: dto.department || null,
      date_of_joining: dto.date_of_joining || null,
      date_of_birth: dto.date_of_birth || null,
      contact_number: dto.contact_number || null,
      email: this.normalizeEmail(user.email) || null,
      address: dto.address || null,
      biometric_id: dto.biometric_id || null,
      status: user.is_active === false ? 'INACTIVE' : 'ACTIVE',
      updated_at: new Date().toISOString(),
    };

    const existingEmployee = await this.findExistingEmployeeForSync(
      tenantId,
      user.id,
      normalizedEmployeeCode,
    );

    if (existingEmployee?.id) {
      const { error: updateError } = await this.supabase
        .from('employees')
        .update(employeePayload)
        .eq('tenant_id', tenantId)
        .eq('id', existingEmployee.id);

      if (updateError) {
        const sanitizedPayload = { ...employeePayload };
        delete sanitizedPayload.user_id;

        if (!this.isMissingColumnError(updateError, 'user_id')) {
          throw new Error(`Failed to update employee profile: ${updateError.message}`);
        }

        const { error: fallbackError } = await this.supabase
          .from('employees')
          .update(sanitizedPayload)
          .eq('tenant_id', tenantId)
          .eq('id', existingEmployee.id);

        if (fallbackError) {
          throw new Error(`Failed to update employee profile: ${fallbackError.message}`);
        }
      }

      return existingEmployee.id;
    }

    const { data: inserted, error: insertError } = await this.supabase
      .from('employees')
      .insert(employeePayload)
      .select('id')
      .single();

    if (insertError) {
      // If another employee already has this employee_code, update that record instead of failing.
      const isDuplicateCode =
        (insertError as any).code === '23505' &&
        (insertError.message?.includes('employee_code') ||
          insertError.message?.includes('employees_tenant_employee_code_unique_idx'));

      if (isDuplicateCode && normalizedEmployeeCode) {
        const { data: byCodeUpdate, error: byCodeUpdateError } = await this.supabase
          .from('employees')
          .update(employeePayload)
          .eq('tenant_id', tenantId)
          .eq('employee_code', normalizedEmployeeCode)
          .select('id')
          .single();

        if (!byCodeUpdateError && byCodeUpdate?.id) {
          return byCodeUpdate.id;
        }
        // If user_id column is missing on this path, retry without it
        if (byCodeUpdateError && this.isMissingColumnError(byCodeUpdateError, 'user_id')) {
          const sanitizedPayload = { ...employeePayload };
          delete sanitizedPayload.user_id;
          const { data: retried, error: retriedError } = await this.supabase
            .from('employees')
            .update(sanitizedPayload)
            .eq('tenant_id', tenantId)
            .eq('employee_code', normalizedEmployeeCode)
            .select('id')
            .single();
          if (!retriedError && retried?.id) return retried.id;
        }
      }

      const sanitizedPayload = { ...employeePayload };
      delete sanitizedPayload.user_id;

      if (!this.isMissingColumnError(insertError, 'user_id')) {
        throw new Error(`Failed to create employee profile: ${insertError.message}`);
      }

      const { data: fallbackInserted, error: fallbackError } = await this.supabase
        .from('employees')
        .insert(sanitizedPayload)
        .select('id')
        .single();

      if (fallbackError || !fallbackInserted) {
        throw new Error(`Failed to create employee profile: ${fallbackError?.message || 'Unknown error'}`);
      }

      return fallbackInserted.id;
    }

    return inserted?.id;
  }

  private async deactivateEmployeeLink(tenantId: string, userId: string) {
    try {
      const { error } = await this.supabase
        .from('employees')
        .update({ status: 'INACTIVE', user_id: null, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);

      if (!error) return;
      throw error;
    } catch (error) {
      throw new Error(`Failed to deactivate linked employee: ${String((error as any)?.message || error)}`);
    }
  }

  private async ensureUniqueUsername(tenantId: string, username: string, ignoreUserId?: string) {
    const normalizedUsername = this.normalizeUsername(username);

    if (!normalizedUsername) {
      throw new ConflictException('Username is required');
    }

    let query = this.supabase
      .from('users')
      .select('id')
      .ilike('username', normalizedUsername)
      .eq('tenant_id', tenantId);

    if (ignoreUserId) {
      query = query.neq('id', ignoreUserId);
    }

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      throw new ConflictException('User with this username already exists');
    }

    return normalizedUsername;
  }

  private async tryLoadUserRoles(tenantId: string, userIds: string[]) {
    if (userIds.length === 0) return new Map<string, any[]>();

    try {
      const { data, error } = await this.supabase
        .from('user_roles')
        .select(
          `user_id,
           role:roles (
             id,
             name,
             permissions
           )`,
        )
        .eq('tenant_id', tenantId)
        .in('user_id', userIds);

      if (error) {
        throw error;
      }

      const map = new Map<string, any[]>();
      for (const row of data || []) {
        const uid = (row as any).user_id as string;
        const role = (row as any).role;
        if (!uid || !role) continue;
        const list = map.get(uid) ?? [];
        list.push(role);
        map.set(uid, list);
      }
      return map;
    } catch {
      return new Map<string, any[]>();
    }
  }

  private async trySyncUserRoles(tenantId: string, userId: string, roleIds: string[]) {
    try {
      // Replace existing assignments
      await this.supabase
        .from('user_roles')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);

      if (roleIds.length === 0) return;

      const rows = roleIds.map((roleId) => ({
        tenant_id: tenantId,
        user_id: userId,
        role_id: roleId,
      }));

      await this.supabase
        .from('user_roles')
        .insert(rows);
    } catch {
      // ignore if user_roles doesn't exist yet
    }
  }

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select(`
        id,
        username,
        email,
        first_name,
        last_name,
        is_active,
        created_at,
        role:roles (
          id,
          name,
          permissions
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch users: ${error.message}`);
    }

    const users = data || [];
    const rolesByUserId = await this.tryLoadUserRoles(
      tenantId,
      users.map((u: any) => u.id),
    );

    const employeesByUserId = await this.tryLoadEmployeeLinks(tenantId, users);

    return users.map((u: any) => {
      const multi = rolesByUserId.get(u.id) ?? [];
      const fallback = u.role ? [u.role] : [];
      const employee = employeesByUserId.get(u.id) || null;
      return {
        ...u,
        employee,
        roles: (multi.length > 0 ? multi : fallback).map((role: any) => ({ role })),
      };
    });
  }

  async findOne(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select(`
        id,
        username,
        email,
        first_name,
        last_name,
        is_active,
        created_at,
        role:roles (
          id,
          name,
          permissions
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    const rolesByUserId = await this.tryLoadUserRoles(tenantId, [data.id]);
    const multi = rolesByUserId.get(data.id) ?? [];
    const fallback = (data as any).role ? [(data as any).role] : [];

    const employeesByUserId = await this.tryLoadEmployeeLinks(tenantId, [data]);

    return {
      ...data,
      employee: employeesByUserId.get(data.id) || null,
      roles: (multi.length > 0 ? multi : fallback).map((role: any) => ({ role })),
    };
  }

  async create(dto: {
    username: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roleId?: string;
    roleIds?: string[];
    tenantId: string;
    employee_code?: string;
    employee_name?: string;
    designation?: string;
    department?: string;
    date_of_joining?: string;
    date_of_birth?: string;
    contact_number?: string;
    address?: string;
    biometric_id?: string;
  }) {
    const normalizedUsername = await this.ensureUniqueUsername(dto.tenantId, dto.username);
    const normalizedEmail = this.normalizeRequiredEmail(dto.email);

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const roleIds = Array.isArray(dto.roleIds)
      ? dto.roleIds.filter(Boolean)
      : dto.roleId
        ? [dto.roleId]
        : [];

    // Create user
    const { data, error } = await this.supabase
      .from('users')
      .insert({
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        first_name: dto.firstName,
        last_name: dto.lastName,
        role_id: roleIds[0] || null,
        tenant_id: dto.tenantId,
        is_active: true,
      })
      .select(`
        id,
        username,
        email,
        first_name,
        last_name,
        is_active,
        created_at
      `)
      .single();

    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }

    try {
      await this.trySyncUserRoles(dto.tenantId, data.id, roleIds);
      await this.syncEmployeeProfile(dto.tenantId, data as any, dto as any);
    } catch (syncError: any) {
      await this.supabase
        .from('user_roles')
        .delete()
        .eq('tenant_id', dto.tenantId)
        .eq('user_id', data.id);

      await this.supabase
        .from('users')
        .delete()
        .eq('tenant_id', dto.tenantId)
        .eq('id', data.id);

      throw new Error(syncError?.message || 'Failed to create employee profile');
    }

    return data;
  }

  async update(
    id: string,
    dto: {
      first_name?: string;
      last_name?: string;
      username?: string;
      role_id?: string;
      roleIds?: string[];
      is_active?: boolean;
      email?: string;
      employee_code?: string;
      employee_name?: string;
      designation?: string;
      department?: string;
      date_of_joining?: string;
      date_of_birth?: string;
      contact_number?: string;
      address?: string;
      biometric_id?: string;
    },
    tenantId: string,
  ) {
    const roleIds = Array.isArray((dto as any).roleIds)
      ? (dto as any).roleIds.filter(Boolean)
      : dto.role_id
        ? [dto.role_id]
        : null;

    const updateDto: any = { ...dto };
    delete updateDto.roleIds;

    if (typeof updateDto.username === 'string') {
      updateDto.username = await this.ensureUniqueUsername(tenantId, updateDto.username, id);
    }

    if (typeof updateDto.email === 'string') {
      updateDto.email = this.normalizeRequiredEmail(updateDto.email);
    }

    const employeeFields = {
      employee_code: updateDto.employee_code,
      employee_name: updateDto.employee_name,
      designation: updateDto.designation,
      department: updateDto.department,
      date_of_joining: updateDto.date_of_joining,
      date_of_birth: updateDto.date_of_birth,
      contact_number: updateDto.contact_number,
      address: updateDto.address,
      biometric_id: updateDto.biometric_id,
    };

    delete updateDto.employee_code;
    delete updateDto.employee_name;
    delete updateDto.designation;
    delete updateDto.department;
    delete updateDto.date_of_joining;
    delete updateDto.date_of_birth;
    delete updateDto.contact_number;
    delete updateDto.address;
    delete updateDto.biometric_id;

    if (roleIds) {
      updateDto.role_id = roleIds[0] || null;
    }

    const { data, error } = await this.supabase
      .from('users')
      .update(updateDto)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(`
        id,
        username,
        email,
        first_name,
        last_name,
        is_active,
        created_at
      `)
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    if (roleIds) {
      await this.trySyncUserRoles(tenantId, id, roleIds);
    }

    try {
      await this.syncEmployeeProfile(tenantId, data as any, employeeFields);
    } catch (syncErr: any) {
      // Log but don't fail the whole update — user record was already updated successfully
      console.warn('[UserService.update] syncEmployeeProfile warning:', syncErr?.message || syncErr);
    }

    return data;
  }

  async delete(id: string, tenantId: string) {
    // First check if user exists
    const { data: user, error: findError } = await this.supabase
      .from('users')
      .select('username, email, first_name, last_name')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (findError || !user) {
      throw new NotFoundException('User not found');
    }

    await this.deactivateEmployeeLink(tenantId, id);

    const { error } = await this.supabase
      .from('users')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      // Check if it's a foreign key constraint error
      if (error.code === '23503') {
        throw new Error(
          `Cannot delete user ${user.first_name} ${user.last_name} (${user.username || user.email}) because they have associated records in the system. ` +
          `Please reassign or delete their records first, or deactivate the user instead.`
        );
      }
      throw new Error(`Failed to delete user: ${error.message}`);
    }

    return { message: 'User deleted successfully' };
  }
}
