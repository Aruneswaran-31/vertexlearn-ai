import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, clearTokens, storeTokens } from './api';
import type { User } from './types';

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { fullName: string; email: string; password: string; role: 'student' | 'instructor' }) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

type SessionResponse = {
  access_token: string;
  refresh_token: string;
  user: User;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('vl_access_token');
    if (!token) {
      setLoading(false);
      return;
    }
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('vl:unauthorized', handler);
    return () => window.removeEventListener('vl:unauthorized', handler);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<SessionResponse>('/auth/login', { email, password });
    storeTokens(data.access_token, data.refresh_token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (input: { fullName: string; email: string; password: string; role: 'student' | 'instructor' }) => {
      const data = await api.post<SessionResponse>('/auth/register', input);
      storeTokens(data.access_token, data.refresh_token);
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('vl_refresh_token');
    try {
      await api.post('/auth/logout', { refresh_token: refreshToken });
    } catch {
      // Logging out locally is enough if the network call fails.
    }
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh, setUser }),
    [user, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
