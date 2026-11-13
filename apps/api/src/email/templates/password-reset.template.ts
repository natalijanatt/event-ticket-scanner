import { button, COLORS, escapeHtml, FONT, layout } from './layout';

export function renderPasswordReset(data: { firstName: string; resetUrl: string }): { subject: string; html: string; text: string } {
  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:32px 32px 8px 32px;font-family:${FONT};font-size:20px;font-weight:700;color:${COLORS.ink};">Zdravo, ${escapeHtml(data.firstName)}!</td></tr>
<tr><td style="padding:0 32px 24px 32px;font-family:${FONT};font-size:15px;line-height:23px;color:${COLORS.ink};">Primili smo zahtev za promenu lozinke tvog naloga. Klikni na dugme ispod da postaviš novu lozinku. Link važi 60 minuta i može se iskoristiti samo jednom.</td></tr>
<tr><td style="padding:0 32px 28px 32px;">${button('POSTAVI NOVU LOZINKU', data.resetUrl)}</td></tr>
<tr><td style="padding:0 32px 32px 32px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};">Ako nisi ti tražio/la promenu lozinke, zanemari ovu poruku — tvoja lozinka ostaje ista.</td></tr>
</table>`;
  return {
    subject: 'Promena lozinke',
    html: layout({ preheader: 'Link za postavljanje nove lozinke', brand: 'Propusnica', body, footer: 'Ova poruka je poslata automatski.' }),
    text: `Zdravo, ${data.firstName}!\n\nPrimili smo zahtev za promenu lozinke. Otvori link ispod da postaviš novu lozinku (važi 60 minuta):\n\n${data.resetUrl}\n\nAko nisi ti tražio/la promenu, zanemari ovu poruku.`,
  };
}
