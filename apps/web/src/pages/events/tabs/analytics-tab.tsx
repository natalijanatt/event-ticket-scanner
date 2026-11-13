import { EMAIL_STATUS_LABELS, type EventStatsDto } from '@event-platform/shared';
import { BarChart3 } from 'lucide-react';
import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/controls';
import { EmptyState, ErrorState, Section, Stat, StatGrid } from '@/components/ui/states';
import { formatNumber, formatPercent, formatTime } from '@/lib/format';
import { useEventContext, useEventStats } from '../event-queries';
import { Meter } from './overview-tab';

// Chart palette – validated with the dataviz palette checker (lightness band,
// chroma, colour-blind separation ΔE ≥ 21, ≥ 3:1 contrast on the surface).
// Colour follows the entity: "ušlo" is always blue, "čeka se" always amber.
const SERIES = { used: '#2F6FB0', waiting: '#B8791B' } as const;
const AXIS = 'hsl(220 8% 58%)';
const GRID = 'hsl(40 14% 86%)';
const tick = { fill: 'hsl(220 10% 40%)', fontSize: 12 };

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-overlay">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            {row.color && <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: row.color }} />}
            {row.label}
          </span>
          <span className="tabular font-semibold text-ink">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Every chart has its numbers available as a plain table (screen readers, copy/paste). */
function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-[13px]">
      <summary className="cursor-pointer font-medium text-ink-muted hover:text-ink">Prikaži podatke u tabeli</summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-md border border-line">
        <table className="w-full text-left">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="border-b border-line bg-subtle/60 px-3 py-1.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-line last:border-b-0">
                {row.map((cell, j) => (
                  <td key={j} className="tabular px-3 py-1.5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px]" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function CheckInsChart({ stats }: { stats: EventStatsDto }) {
  const data = stats.checkInsOverTime.map((p) => ({ ...p, label: formatTime(p.time) }));
  if (data.length === 0) {
    return <EmptyState bare icon={BarChart3} title="Još nema ulazaka" description="Grafikon se popunjava kako gosti ulaze." className="py-10" />;
  }
  // A lone point cannot draw a line – anchor it to zero one interval earlier.
  const series = data.length === 1 ? [{ ...data[0], label: '', count: 0, cumulative: 0, time: '' }, ...data] : data;
  return (
    <>
      <div className="h-64" role="img" aria-label={`Ulasci tokom vremena: ukupno ${stats.tickets.used}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: AXIS }} minTickGap={32} />
            <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
            <ChartTooltip
              cursor={{ stroke: AXIS, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof series)[number] | undefined;
                if (!active || !p || !p.label) return null;
                return (
                  <TooltipBox
                    title={`do ${p.label}`}
                    rows={[
                      { label: 'Ukupno ušlo', value: formatNumber(p.cumulative), color: SERIES.used },
                      { label: 'U ovih 15 min', value: formatNumber(p.count) },
                    ]}
                  />
                );
              }}
            />
            <Area type="monotone" dataKey="cumulative" stroke={SERIES.used} strokeWidth={2} fill={SERIES.used} fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <DataTable head={['Interval od', 'Ulazaka', 'Ukupno']} rows={data.map((p) => [p.label, p.count, p.cumulative])} />
    </>
  );
}

function TicketTypesChart({ stats }: { stats: EventStatsDto }) {
  const data = stats.ticketTypes.filter((t) => t.used + t.valid > 0).map((t) => ({ name: t.name, used: t.used, waiting: t.valid, revoked: t.revoked, total: t.used + t.valid }));
  if (data.length === 0) {
    return <EmptyState bare icon={BarChart3} title="Nema izdatih karata" description="Raspodela po tipovima pojaviće se kada generišeš karte." className="py-10" />;
  }
  return (
    <>
      <Legend
        items={[
          { label: 'Ušlo', color: SERIES.used },
          { label: 'Još se očekuje', color: SERIES.waiting },
        ]}
      />
      <div style={{ height: Math.max(120, data.length * 48 + 28) }} role="img" aria-label="Karte po tipu: iskorišćene i neiskorišćene.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barSize={14}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ ...tick, fill: 'hsl(220 28% 14%)', fontSize: 13 }} tickLine={false} axisLine={{ stroke: AXIS }} width={92} />
            <ChartTooltip
              cursor={{ fill: 'hsl(42 20% 92% / 0.6)' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <TooltipBox
                    title={p.name}
                    rows={[
                      { label: 'Ušlo', value: formatNumber(p.used), color: SERIES.used },
                      { label: 'Još se očekuje', value: formatNumber(p.waiting), color: SERIES.waiting },
                      ...(p.revoked > 0 ? [{ label: 'Poništeno', value: formatNumber(p.revoked) }] : []),
                    ]}
                  />
                );
              }}
            />
            {/* 2px surface-coloured stroke separates the stacked segments. */}
            <Bar dataKey="used" stackId="a" fill={SERIES.used} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
            <Bar dataKey="waiting" stackId="a" fill={SERIES.waiting} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="total" position="right" fill="hsl(220 28% 14%)" fontSize={12} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable head={['Tip karte', 'Ušlo', 'Očekuje se', 'Poništeno']} rows={data.map((t) => [t.name, t.used, t.waiting, t.revoked])} />
    </>
  );
}

function InvitationsChart({ stats }: { stats: EventStatsDto }) {
  const inv = stats.invitations;
  const data = [
    { name: EMAIL_STATUS_LABELS.NOT_SENT, value: inv.NOT_SENT },
    { name: EMAIL_STATUS_LABELS.QUEUED, value: inv.QUEUED + inv.SENDING },
    { name: EMAIL_STATUS_LABELS.SENT, value: inv.SENT },
    { name: EMAIL_STATUS_LABELS.DELIVERED, value: inv.DELIVERED },
    { name: EMAIL_STATUS_LABELS.FAILED, value: inv.BOUNCED + inv.FAILED },
  ];
  return (
    <>
      <div className="h-56" role="img" aria-label="Broj gostiju po statusu pozivnice.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barSize={14}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ ...tick, fill: 'hsl(220 28% 14%)', fontSize: 13 }} tickLine={false} axisLine={{ stroke: AXIS }} width={138} />
            <ChartTooltip
              cursor={{ fill: 'hsl(42 20% 92% / 0.6)' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                const share = stats.guests.total > 0 ? (p.value / stats.guests.total) * 100 : 0;
                return <TooltipBox title={p.name} rows={[{ label: 'Gostiju', value: `${formatNumber(p.value)} · ${formatPercent(share)}` }]} />;
              }}
            />
            {/* One series, one colour: bar length carries the magnitude. */}
            <Bar dataKey="value" fill={SERIES.used} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="value" position="right" fill="hsl(220 28% 14%)" fontSize={12} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable head={['Status pozivnice', 'Gostiju']} rows={data.map((d) => [d.name, d.value])} />
    </>
  );
}

export function EventAnalyticsTab() {
  const { event } = useEventContext();
  const stats = useEventStats(event.id);

  if (stats.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;

  const s = stats.data;
  const active = s.tickets.valid + s.tickets.used;
  const invited = s.invitations.SENT + s.invitations.DELIVERED;
  const failed = s.invitations.BOUNCED + s.invitations.FAILED;

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat label="Pozvani gosti" value={formatNumber(s.guests.total)} hint={`${formatNumber(s.guests.checkedIn)} je ušlo`} />
        <Stat label="Generisane karte" value={formatNumber(s.tickets.generated)} hint={`od ${formatNumber(s.tickets.allocated)} dodeljenih`} />
        <Stat label="Važeće karte" value={formatNumber(s.tickets.valid)} hint="još nisu iskorišćene" />
        <Stat label="Iskorišćene karte" value={formatNumber(s.tickets.used)} tone="success" hint={`${formatPercent(s.checkInRate)} prolaznost`} />
        <Stat label="Poništene karte" value={formatNumber(s.tickets.revoked)} tone={s.tickets.revoked > 0 ? 'danger' : 'default'} />
      </StatGrid>
      <StatGrid className="lg:grid-cols-3">
        <Stat label="Poslate pozivnice" value={formatNumber(invited)} hint="prihvaćene od servisa za slanje" />
        <Stat label="Potvrđene isporuke" value={formatNumber(s.invitations.DELIVERED)} hint="stigle na server primaoca" />
        <Stat label="Neuspela slanja" value={formatNumber(failed)} tone={failed > 0 ? 'danger' : 'default'} />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Ulasci tokom vremena" description="Ukupan broj skeniranih karata, u intervalima od 15 minuta.">
          <CheckInsChart stats={s} />
        </Section>

        <Section title="Trenutna popunjenost" description="Na osnovu uspešno skeniranih karata.">
          <div className="tabular text-5xl font-bold leading-none tracking-tight">{formatNumber(s.tickets.used)}</div>
          <div className="mt-2 text-sm text-ink-muted">
            {s.capacity ? `od ${formatNumber(s.capacity)} mesta · ${formatPercent((s.tickets.used / s.capacity) * 100)}` : `od ${formatNumber(active)} izdatih karata`}
          </div>
          <div className="mt-5">
            <Meter value={s.tickets.used} max={s.capacity ?? active} label="Popunjenost" />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-ink-muted">Još se očekuje</dt>
              <dd className="tabular text-lg font-bold">{formatNumber(s.tickets.valid)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{s.capacity ? 'Slobodnih mesta' : 'Gostiju unutra'}</dt>
              <dd className="tabular text-lg font-bold">{formatNumber(s.capacity ? Math.max(0, s.capacity - s.tickets.used) : s.guests.checkedIn)}</dd>
            </div>
          </dl>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Karte po tipu" description="Koliko je karata svakog tipa iskorišćeno.">
          <TicketTypesChart stats={s} />
        </Section>
        <Section title="Pozivnice po statusu isporuke" description="Svaki gost se broji jednom, po poslednjoj poslatoj poruci.">
          <InvitationsChart stats={s} />
        </Section>
      </div>
    </div>
  );
}
