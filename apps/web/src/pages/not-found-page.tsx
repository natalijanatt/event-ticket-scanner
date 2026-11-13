import { Link } from 'react-router-dom';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-6 py-8">
      <Brand />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="font-mono text-sm font-semibold text-ink-faint">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Stranica nije pronađena</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">Adresa koju si otvorio/la ne postoji ili je premeštena.</p>
        <Button asChild className="mt-8">
          <Link to="/">Nazad na početnu</Link>
        </Button>
      </div>
    </div>
  );
}
