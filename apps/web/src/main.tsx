import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App } from './App';
import { AuthProvider } from './auth/auth-context';
import { TooltipProvider } from './components/ui/controls';
import { queryClient } from './lib/query-client';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast: '!rounded-md !border !border-line !bg-surface !text-ink !shadow-overlay !font-sans',
            description: '!text-ink-muted',
          },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>,
);
