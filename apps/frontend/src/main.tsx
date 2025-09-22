import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ToastProvider } from './components/toast';
import { RouterProvider } from 'react-router-dom';
import { createAppRouter } from './routes/router';

const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>
);
