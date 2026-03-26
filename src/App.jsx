import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import { ConfirmProvider, useConfirm } from '@/contexts/ConfirmContext';
import { NavActionsProvider } from '@/contexts/NavActionsContext';
import { ThemeProvider } from '@/hooks/useTheme';
import ToastContainer from '@/components/common/ToastContainer';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import AppLayout from '@/components/layout/AppLayout';

const AuthPage = lazy(() => import('@/pages/AuthPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const SplitPage = lazy(() => import('@/pages/SplitPage'));
const JoinPage = lazy(() => import('@/pages/SplitPage').then(m => ({ default: m.JoinPage })));

function LoadingFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '1.25rem',
        color: 'var(--color-text-secondary)',
      }}
      role="status"
      aria-live="polite"
    >
      載入中…
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingFallback />;
  if (!session) {
    const currentPath = location.pathname + location.search;
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    if (currentPath !== '/' && currentPath !== base && currentPath !== base + '/') {
      sessionStorage.setItem('returnUrl', currentPath);
    }
    return <Navigate to="/auth" replace />;
  }
  return children;
}

function AppShell() {
  const toast = useToast();
  const { confirmState, handleConfirm, handleCancel } = useConfirm();

  return (
    <>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <DashboardPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/split"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <SplitPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/split/join/:code?"
            element={
              <ProtectedRoute>
                <JoinPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                <NavActionsProvider>
                  <AppShell />
                </NavActionsProvider>
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
