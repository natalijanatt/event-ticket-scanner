import { button, COLORS, escapeHtml, FONT, layout } from './layout';

export interface InvitationTicket {
  reference: string;
  url: string;
  typeName: string;
  /** `cid:…` or a data URL of the QR image; omitted when QR embedding is off. */
  qrSrc?: string;
}

export interface InvitationData {
  guestFirstName: string;
  eventName: string;
  dateLong: string;
  dateShort: string;
  time: string;
  venueName: string;
  venueAddress: string | null;
  organizerName: string;
  coverImageUrl: string | null;
  instructions: string | null;
  tickets: InvitationTicket[];
}

/** 1 ulaznica · 2–4 ulaznice · 5+ ulaznica (Serbian plural rules). */
export function ticketsNoun(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ulaznica';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ulaznice';
  return 'ulaznica';
}

export function invitationSubject(data: Pick<InvitationData, 'eventName' | 'dateShort'>): string {
  return `Pozivnica za ${data.eventName} – ${data.dateShort}`;
}

function detailRow(label: string, value: string): string {
  return `<tr>
<td style="padding:6px 16px 6px 0;font-family:${FONT};font-size:13px;color:${COLORS.muted};white-space:nowrap;vertical-align:top;">${label}</td>
<td style="padding:6px 0;font-family:${FONT};font-size:15px;font-weight:600;color:${COLORS.ink};">${value}</td>
</tr>`;
}

function ticketBlock(ticket: InvitationTicket, index: number, total: number): string {
  const title = total > 1 ? `Ulaznica ${index + 1} od ${total}` : 'Tvoja ulaznica';
  const qr = ticket.qrSrc
    ? `<td width="112" style="padding:0 16px 0 0;vertical-align:middle;"><img src="${escapeHtml(ticket.qrSrc)}" width="112" height="112" alt="QR kod ulaznice ${escapeHtml(ticket.reference)}" style="display:block;border:1px solid ${COLORS.line};border-radius:6px;"></td>`
    : '';
  return `<tr><td style="padding:0 32px 14px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLORS.line};border-radius:8px;">
<tr><td style="padding:16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
${qr}
<td style="vertical-align:middle;">
<div style="font-family:${FONT};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.muted};">${title}</div>
<div style="font-family:${FONT};font-size:16px;font-weight:700;color:${COLORS.ink};padding:4px 0 2px 0;">${escapeHtml(ticket.typeName)}</div>
<div style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:13px;color:${COLORS.muted};padding-bottom:10px;">${escapeHtml(ticket.reference)}</div>
<a href="${escapeHtml(ticket.url)}" target="_blank" style="font-family:${FONT};font-size:14px;font-weight:700;color:${COLORS.navy};text-decoration:underline;">Otvori ulaznicu →</a>
</td>
</tr></table>
</td></tr>
</table>
</td></tr>`;
}

export function renderInvitationHtml(data: InvitationData): string {
  const count = data.tickets.length;
  const single = count === 1;
  const name = escapeHtml(data.guestFirstName);
  const event = escapeHtml(data.eventName);
  const venue = escapeHtml(data.venueName) + (data.venueAddress ? `<br><span style="font-weight:400;color:${COLORS.muted};font-size:13px;">${escapeHtml(data.venueAddress)}</span>` : '');

  const cover = data.coverImageUrl
    ? `<tr><td><img src="${escapeHtml(data.coverImageUrl)}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></td></tr>`
    : `<tr><td bgcolor="${COLORS.navy}" style="background-color:${COLORS.navy};padding:36px 32px;">
<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${COLORS.accent};">Pozivnica</div>
<div style="font-family:${FONT};font-size:28px;line-height:34px;font-weight:800;color:#FFFFFF;padding-top:8px;">${event}</div>
</td></tr>`;

  const intro = single
    ? `Tvoja ulaznica je spremna.<br>Klikni na dugme ispod da otvoriš svoju digitalnu kartu i QR kod koji će biti skeniran na ulazu.`
    : `Za tebe ${count >= 2 && count <= 4 ? 'su spremne' : 'je spremno'} <strong>${count} ${ticketsNoun(count)}</strong>. Svaka ima svoj QR kod i važi za jednu osobu — prosledi ih društvu ili ih pokaži zajedno na ulazu.`;

  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${cover}
<tr><td style="padding:32px 32px 8px 32px;font-family:${FONT};font-size:20px;font-weight:700;color:${COLORS.ink};">Zdravo, ${name}!</td></tr>
<tr><td style="padding:0 32px 20px 32px;font-family:${FONT};font-size:16px;line-height:24px;color:${COLORS.ink};">Čeka te pozivnica za <strong>${event}</strong>!</td></tr>
<tr><td style="padding:0 32px 24px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.line};border-bottom:1px solid ${COLORS.line};">
<tr><td style="padding:12px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
${detailRow('Datum', escapeHtml(data.dateLong))}
${detailRow('Vreme', escapeHtml(data.time))}
${detailRow('Lokacija', venue)}
</table>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:0 32px 24px 32px;font-family:${FONT};font-size:15px;line-height:23px;color:${COLORS.ink};">${intro}</td></tr>
${single ? `<tr><td align="left" style="padding:0 32px 28px 32px;">${button('OTVORI ULAZNICU', data.tickets[0].url)}</td></tr>` : ''}
${data.tickets.map((t, i) => ticketBlock(t, i, count)).join('\n')}
${data.instructions ? `<tr><td style="padding:6px 32px 18px 32px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};"><strong style="color:${COLORS.ink};">Napomena:</strong> ${escapeHtml(data.instructions)}</td></tr>` : ''}
<tr><td style="padding:10px 32px 32px 32px;font-family:${FONT};font-size:16px;font-weight:700;color:${COLORS.ink};">Vidimo se!</td></tr>
</table>`;

  const footer = `Ovu poruku šalje ${escapeHtml(data.organizerName)}. Link ka ulaznici je ličan — ko ima link, može da iskoristi ulaznicu, zato ga ne deli javno.<br>Ako ne očekuješ ovu pozivnicu, slobodno je zanemari.`;

  return layout({
    preheader: `${data.dateLong} u ${data.time} · ${data.venueName}`,
    brand: data.organizerName,
    body,
    footer,
  });
}

export function renderInvitationText(data: InvitationData): string {
  const count = data.tickets.length;
  const lines = [
    `Zdravo, ${data.guestFirstName}!`,
    '',
    `Čeka te pozivnica za ${data.eventName}!`,
    '',
    `Datum: ${data.dateLong}`,
    `Vreme: ${data.time}`,
    `Lokacija: ${data.venueName}${data.venueAddress ? `, ${data.venueAddress}` : ''}`,
    '',
  ];
  if (count === 1) {
    lines.push('Tvoja ulaznica je spremna. Otvori je na linku ispod — QR kod će biti skeniran na ulazu.', '', data.tickets[0].url);
  } else {
    lines.push(`Broj ulaznica: ${count}. Svaka ima svoj QR kod i važi za jednu osobu.`, '');
    data.tickets.forEach((t, i) => lines.push(`Ulaznica ${i + 1} (${t.typeName}, ${t.reference}): ${t.url}`));
  }
  if (data.instructions) lines.push('', `Napomena: ${data.instructions}`);
  lines.push('', 'Vidimo se!', '', `— ${data.organizerName}`);
  return lines.join('\n');
}
