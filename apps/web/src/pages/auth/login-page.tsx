import { loginSchema, type LoginInput } from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { homePathFor, useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values);
      const from = (location.state as { from?: string } | null)?.from;
      // Only follow same-app paths that the user's role can actually open.
      const target = from && from.startsWith('/') && !(user.role === 'SCANNER' && !from.startsWith('/scanner')) ? from : homePathFor(user.role);
      navigate(target, { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
      form.setFocus('password');
    }
  });

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Prijava</h1>
      <p className="mt-2 text-sm text-ink-muted">Prijavi se da upravljaš događajima ili skeniraš ulaznice.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        {formError && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {formError}
          </div>
        )}

        <Field label="Email adresa" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus inputMode="email" aria-invalid={!!errors.email} {...form.register('email')} />
        </Field>

        <Field label="Lozinka" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register('password')} />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Prijavi se
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        <Link to="/forgot-password" className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Zaboravljena lozinka?
        </Link>
      </p>
    </div>
  );
}
