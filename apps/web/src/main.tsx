import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import '@/shared/i18n'
import './index.css'
import { AuthProvider, useAuth } from '@/app/auth'
import { router } from '@/app/router'
import { ToastProvider } from '@/shared/ui/toast'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

function App() {
  const auth = useAuth()

  // Re-run route guards when the session or tenant changes.
  useEffect(() => {
    if (auth.ready) router.invalidate()
  }, [auth.ready, auth.session, auth.claims?.tenant_id])

  if (!auth.ready) return null
  return <RouterProvider router={router} context={{ auth }} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
