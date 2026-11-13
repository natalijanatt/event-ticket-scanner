import { forgotPasswordSchema, type ForgotPasswordInput } from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/auth/forgot-password', values, { skipRefresh: true });
      setSentTo(values.email);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  const back = (
    <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
      <ArrowLeft className="size-4" aria-hidden /> Nazad na prijavu
    </Link>
  );

  if (sentTo) {
    return (
      <div>
        <div className="flex size-11 items-center justify-center rounded-md border border-success/25 bg-success-soft text-success">
          <MailCheck className="size-5" aria-hidden />
        </div>
        <h1 className="mt-5 text-[28px] font-bold tracking-tight">Proveri email</h1>
        {/* Same message whether or not the account exists – no account enumeration. */}
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Ako nalog sa adresom <strong className="text-ink">{sentTo}</strong> postoji, poslali smo link za postavljanje nove lozinke. Link važi 60 minuta.
        </p>
        <div className="mt-8">{back}</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Zaboravljena lozinka</h1>
      <p className="mt-2 text-sm text-ink-muted">Unesi email adresu naloga i poslaćemo ti link za postavljanje nove lozinke.</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <Field label="Email adresa" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus inputMode="email" aria-invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Pošalji link
        </Button>
      </form>
      <div className="mt-6">{back}</div>
    </div>
  );
}
