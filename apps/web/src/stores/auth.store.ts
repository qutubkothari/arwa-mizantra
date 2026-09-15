/**
 * Global auth store — single source of truth for the current user.
 * Replaces all scattered `JSON.parse(localStorage.getItem('user'))` calls.
 */
import { create } from 'zustand';
import { type StoredUser } from '@/lib/rbac';

interface AuthState {
  user: StoredUser | null;
  isReady: boolean;
  /** Load user from localStorage into the store */
  hydrate: () => void;
  /** Called after login — persists user and updates store */
  setUser: (user: StoredUser) => void;
  /** Clear user and localStorage on logout */
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isReady: false,

  hydrate: () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('user');
      const user = raw ? (JSON.parse(raw) as StoredUser) : null;
      set({ user, isReady: true });
    } catch {
      set({ user: null, isReady: true });
    }
  },

  setUser: (user: StoredUser) => {
    try {
      localStorage.setItem('user', JSON.stringify(user));
    } catch {
      /* ignore */
    }
    set({ user, isReady: true });
  },

  clearUser: () => {
    try {
      localStorage.removeItem('user');
    } catch {
      /* ignore */
    }
    set({ user: null, isReady: true });
  },
}));

/** Convenience selector — get the current user object */
export const selectUser = (s: AuthState) => s.user;

/** Get the user's display name, falling back to email */
export function getUserDisplayName(user: StoredUser | null): string {
  if (!user) return 'User';
  const first = (user as Record<string, unknown>).first_name ?? (user as Record<string, unknown>).firstName;
  const last = (user as Record<string, unknown>).last_name ?? (user as Record<string, unknown>).lastName;
  if (typeof first === 'string' && first.trim()) {
    return [first, typeof last === 'string' ? last : ''].filter(Boolean).join(' ').trim();
  }
  if (typeof (user as Record<string, unknown>).username === 'string') {
    return String((user as Record<string, unknown>).username);
  }
  return typeof user.email === 'string' ? user.email : 'User';
}

/** Get the user's top role name (first role) */
export function getUserRoleLabel(user: StoredUser | null): string {
  if (!user) return '';
  const rawRoles = (user as Record<string, unknown>).roles;
  if (Array.isArray(rawRoles) && rawRoles.length > 0) {
    const first = rawRoles[0] as Record<string, unknown>;
    const role = first?.role as Record<string, unknown> | undefined;
    if (typeof role?.name === 'string') return role.name;
    if (typeof first === 'string') return first;
  }
  const single = user.role as Record<string, unknown> | undefined;
  if (typeof single?.name === 'string') return single.name;
  return '';
}

/** Get two-character initials for avatar */
export function getUserInitials(user: StoredUser | null): string {
  const name = getUserDisplayName(user);
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return 'U';
}
