// Shared e-mail chrome. Table layout + inline styles only: this is what
// Gmail, Outlook (Word engine), Apple Mail and Yahoo all render reliably.

export const COLORS = {
  navy: '#0E1726',
  ink: '#1B2434',
  muted: '#5B6577',
  line: '#E4E1DA',
  paper: '#FFFFFF',
  canvas: '#F4F2EC',
  accent: '#D9A441',
};

export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function button(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${COLORS.navy}" style="border-radius:6px;">
<a href="${safeUrl}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:0.08em;color:#FFFFFF;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

export function layout(opts: { preheader: string; brand: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="sr-Latn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(opts.brand)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.canvas};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.canvas}">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px 4px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${COLORS.muted};">${escapeHtml(opts.brand)}</td></tr>
<tr><td bgcolor="${COLORS.paper}" style="background-color:${COLORS.paper};border:1px solid ${COLORS.line};border-radius:10px;overflow:hidden;">
${opts.body}
</td></tr>
<tr><td style="padding:20px 4px 0 4px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">${opts.footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
