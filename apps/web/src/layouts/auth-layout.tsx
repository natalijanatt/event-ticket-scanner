import { Outlet } from 'react-router-dom';
import { Brand } from '@/components/brand';

/** Split screen: navy brand panel + form. Collapses to the form alone on small screens. */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-navy text-navy-text lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Brand tone="light" />
        <div className="relative z-10 max-w-md">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-accent">Pozivnice i ulaznice</p>
          <h2 className="mt-4 text-[34px] font-bold leading-[1.15] tracking-tight">Od liste gostiju do ulaza u klub, bez gužve.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-muted">
            Pošalji personalizovane pozivnice sa QR ulaznicama, a na ulazu skeniraj telefonom. Svaka karta važi tačno jednom.
          </p>
        </div>
        <p className="text-xs text-navy-muted">© {new Date().getFullYear()} Propusnica</p>
        {/* Oversized perforation motif, echoing a ticket edge. */}
        <div aria-hidden className="pointer-events-none absolute -right-5 inset-y-0 flex flex-col justify-around">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} className="block size-10 rounded-full bg-canvas" />
          ))}
        </div>
      </aside>

      <div className="flex flex-col px-5 py-8 sm:px-10 lg:pl-20">
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-[400px] py-10">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
