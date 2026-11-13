import { USER_ROLE_LABELS } from '@event-platform/shared';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Building2, CalendarDays, LayoutDashboard, LogOut, Menu, ScanLine, Settings, UserCog, Users, X, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth, useUser } from '@/auth/auth-context';
import { Brand } from '@/components/brand';
import { Spinner } from '@/components/ui/controls';
import { cn, initials } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  superAdminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Pregled', icon: LayoutDashboard },
  { to: '/events', label: 'Događaji', icon: CalendarDays },
  { to: '/staff', label: 'Osoblje', icon: Users },
  { to: '/organizers', label: 'Organizatori', icon: Building2, superAdminOnly: true },
  { to: '/users', label: 'Korisnici', icon: UserCog, superAdminOnly: true },
  { to: '/settings', label: 'Podešavanja', icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = React.useState(false);

  const items = NAV.filter((item) => !item.superAdminOnly || user.role === 'SUPER_ADMIN');

  async function handleLogout() {
    setLeaving(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      toast.error('Odjava nije uspela. Pokušaj ponovo.');
      setLeaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-navy text-navy-text">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link to="/dashboard" onClick={onNavigate} className="rounded-md focus-visible:ring-offset-navy">
          <Brand tone="light" />
        </Link>
      </div>

      <nav aria-label="Glavna navigacija" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-offset-navy',
                isActive ? 'bg-navy-raised text-navy-text' : 'text-navy-muted hover:bg-navy-raised/60 hover:text-navy-text',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-accent" />}
                <item.icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                {item.label}
              </>
            )}
          </NavLink>
        ))}

        <div className="my-3 border-t border-navy-line" />
        <NavLink
          to="/scanner"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-navy-muted transition-colors hover:bg-navy-raised/60 hover:text-navy-text focus-visible:ring-offset-navy"
        >
          <ScanLine className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          Skener ulaznica
        </NavLink>
      </nav>

      <div className="shrink-0 border-t border-navy-line p-3">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-navy-raised text-xs font-bold text-accent" aria-hidden>
            {initials(user.firstName, user.lastName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {user.firstName} {user.lastName}
            </div>
            <div className="truncate text-xs text-navy-muted">{user.organizers[0]?.name ?? USER_ROLE_LABELS[user.role]}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={leaving}
            className="rounded-md p-2 text-navy-muted transition-colors hover:bg-navy-raised hover:text-navy-text focus-visible:ring-offset-navy disabled:opacity-60"
            aria-label="Odjavi se"
            title="Odjavi se"
          >
            {leaving ? <Spinner className="size-4 text-navy-muted" /> : <LogOut className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const [open, setOpen] = React.useState(false);
  const location = useLocation();

  React.useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh bg-canvas lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-navy focus:px-4 focus:py-2 focus:text-navy-text">
        Preskoči na sadržaj
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-navy-line bg-navy px-4 lg:hidden">
        <Link to="/dashboard" className="rounded-md focus-visible:ring-offset-navy">
          <Brand tone="light" />
        </Link>
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Trigger className="rounded-md p-2 text-navy-text focus-visible:ring-offset-navy" aria-label="Otvori meni">
            <Menu className="size-5" />
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-navy/60 data-[state=open]:animate-fade-in lg:hidden" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] data-[state=open]:animate-fade-in lg:hidden">
              <DialogPrimitive.Title className="sr-only">Meni</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Glavna navigacija</DialogPrimitive.Description>
              <SidebarContent onNavigate={() => setOpen(false)} />
              <DialogPrimitive.Close className="absolute right-3 top-4 rounded-md p-1.5 text-navy-muted hover:text-navy-text" aria-label="Zatvori meni">
                <X className="size-5" />
              </DialogPrimitive.Close>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>

      <main id="main" className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
