import { passwordSchema } from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

const schema = z
  .object({ password: passwordSchema, confirm: z.string().min(1, 'Ponovi lozinku.') })
  .refine((v) => v.password === v.confirm, { message: 'Lozinke se ne poklapaju.', path: ['confirm'] });
type Values = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password }, { skipRefresh: true });
      setDone(true);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  if (done) {
    return (
      <div>
        <div className="flex size-11 items-center justify-center rounded-md border border-success/25 bg-success-soft text-success">
          <CheckCircle2 className="size-5" aria-hidden />
        </div>
        <h1 className="mt-5 text-[28px] font-bold tracking-tight">Lozinka je promenjena</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">Iz bezbednosnih razloga odjavljen/a si sa svih uređaja. Prijavi se novom lozinkom.</p>
        <Button asChild size="lg" className="mt-8 w-full">
          <Link to="/login">Idi na prijavu</Link>
        </Button>
      </div>
    );
  }

  if (!token) {
    return (
      <div>
        <h1 className="text-[28px] font-bold tracking-tight">Link nije ispravan</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">Link za promenu lozinke je nepotpun ili je istekao. Zatraži novi.</p>
        <Button asChild size="lg" className="mt-8 w-full">
          <Link to="/forgot-password">Zatraži novi link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Nova lozinka</h1>
      <p className="mt-2 text-sm text-ink-muted">Izaberi lozinku od najmanje 10 znakova, sa bar jednim slovom i jednom cifrom.</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        {formError && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {formError}{' '}
              <Link to="/forgot-password" className="underline underline-offset-2">
                Zatraži novi link
              </Link>
            </span>
          </div>
        )}
        <Field label="Nova lozinka" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password} {...form.register('password')} />
        </Field>
        <Field label="Ponovi lozinku" htmlFor="confirm" error={errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Sačuvaj lozinku
        </Button>
      </form>
    </div>
  );
}
