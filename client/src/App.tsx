import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { Spinner } from './lib/ui';
import type { Role } from './lib/types';
import AppShell from './components/AppShell';
import Landing from './pages/Landing';
import AuthPage from './pages/AuthPage';
import Catalog from './pages/Catalog';
import CourseDetail from './pages/CourseDetail';
import StudentDashboard from './pages/StudentDashboard';
import Player from './pages/Player';
import QuizPage from './pages/QuizPage';
import AssignmentsPage from './pages/AssignmentsPage';
import AssignmentDetail from './pages/AssignmentDetail';
import Achievements from './pages/Achievements';
import InstructorDashboard from './pages/InstructorDashboard';
import InstructorCourse from './pages/InstructorCourse';
import AdminPanel from './pages/AdminPanel';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';

export function homeFor(role: Role | undefined): string {
  if (role === 'instructor') return '/instructor';
  if (role === 'admin') return '/admin';
  return '/dashboard';
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Starting VertexLearn" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />

      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/courses/:id" element={<CourseDetail />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />

        <Route
          path="/dashboard"
          element={
            <RoleGate roles={['student']}>
              <StudentDashboard />
            </RoleGate>
          }
        />
        <Route
          path="/courses/:id/learn"
          element={
            <RoleGate roles={['student']}>
              <Player />
            </RoleGate>
          }
        />
        <Route
          path="/quizzes/:id"
          element={
            <RoleGate roles={['student', 'instructor', 'admin']}>
              <QuizPage />
            </RoleGate>
          }
        />
        <Route
          path="/assignments"
          element={
            <RoleGate roles={['student']}>
              <AssignmentsPage />
            </RoleGate>
          }
        />
        <Route
          path="/assignments/:id"
          element={
            <RoleGate roles={['student', 'instructor', 'admin']}>
              <AssignmentDetail />
            </RoleGate>
          }
        />
        <Route
          path="/achievements"
          element={
            <RoleGate roles={['student']}>
              <Achievements />
            </RoleGate>
          }
        />

        <Route
          path="/instructor"
          element={
            <RoleGate roles={['instructor', 'admin']}>
              <InstructorDashboard />
            </RoleGate>
          }
        />
        <Route
          path="/instructor/courses/:id"
          element={
            <RoleGate roles={['instructor', 'admin']}>
              <InstructorCourse />
            </RoleGate>
          }
        />

        <Route
          path="/admin"
          element={
            <RoleGate roles={['admin']}>
              <AdminPanel />
            </RoleGate>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
