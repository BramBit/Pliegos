import { Alert } from '../entities/alert.entity';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { Change } from '../../../opportunity/domain/value-objects/opportunity.value-objects';

export interface AlertEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function formatCopAmount(amount: number, amountKnown: boolean): string {
  if (!amountKnown || amount <= 0) {
    return 'Cuantía no determinada';
  }
  const formatted = Math.round(amount).toLocaleString('es-CO');
  return `$ ${formatted} COP`;
}

export function formatBogotaDate(date: Date | null): string {
  if (!date) {
    return 'No informada';
  }
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function findMatchingChange(
  alert: Alert,
  opportunity: Opportunity,
): Change | undefined {
  if (!alert.changeKey) {
    return undefined;
  }
  return (
    opportunity.changeHistory.find((c) => {
      const iso =
        c.detectedAt instanceof Date
          ? c.detectedAt.toISOString()
          : new Date(c.detectedAt).toISOString();
      return `${c.field}:${iso}` === alert.changeKey;
    }) ??
    opportunity.changeHistory.find((c) =>
      alert.changeKey.startsWith(`${c.field}:`),
    )
  );
}

function buildChangeDetails(
  alert: Alert,
  opportunity: Opportunity,
): { detailText: string; detailHtml: string } {
  if (alert.trigger === 'DeadlineApproaching') {
    const closingStr = formatBogotaDate(opportunity.closingDate);
    const detailText = `El plazo para participar en esta oportunidad está próximo a vencer.\nFecha límite de presentación: ${closingStr}`;
    const detailHtml = `
      <p style="margin: 0 0 10px 0; color: #b45309; font-weight: 600;">
        ⚠️ El plazo para participar en esta oportunidad está próximo a vencer.
      </p>
      <p style="margin: 0; color: #374151;">
        <strong>Fecha límite de presentación:</strong> ${closingStr}
      </p>
    `;
    return { detailText, detailHtml };
  }

  const change = findMatchingChange(alert, opportunity);
  if (change) {
    const fieldLabel =
      change.field === 'status'
        ? 'Estado del proceso'
        : change.field === 'closingDate'
          ? 'Fecha de cierre'
          : change.field === 'amount'
            ? 'Cuantía'
            : change.field;

    const detailText = `Campo modificado: ${fieldLabel}\nValor anterior: ${change.previousValue}\nNuevo valor: ${change.newValue}`;
    const detailHtml = `
      <p style="margin: 0 0 8px 0; font-weight: 600; color: #111827;">Modificación registrada:</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #6b7280; width: 140px;"><strong>Campo:</strong></td>
          <td style="padding: 6px 0; color: #111827;">${fieldLabel}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280;"><strong>Valor anterior:</strong></td>
          <td style="padding: 6px 0; color: #dc2626; text-decoration: line-through;">${change.previousValue || '(vacío)'}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280;"><strong>Nuevo valor:</strong></td>
          <td style="padding: 6px 0; color: #16a34a; font-weight: 600;">${change.newValue || '(vacío)'}</td>
        </tr>
      </table>
    `;
    return { detailText, detailHtml };
  }

  const fallback = alert.changeKey
    ? `Cambio detectado: ${alert.changeKey}`
    : 'Se detectó una actualización relevante en el proceso.';
  return {
    detailText: fallback,
    detailHtml: `<p style="margin: 0; color: #374151;">${fallback}</p>`,
  };
}

export function buildAlertEmail(
  alert: Alert,
  opportunity: Opportunity,
  profile: Profile,
): AlertEmailContent {
  let subjectPrefix: string;
  switch (alert.trigger) {
    case 'Amendment':
      subjectPrefix = 'Adenda detectada';
      break;
    case 'StatusChange':
      subjectPrefix = 'Cambio de estado';
      break;
    case 'DeadlineApproaching':
      subjectPrefix = 'Plazo próximo a vencer';
      break;
    default:
      subjectPrefix = 'Actualización';
  }

  const subject = `[Pliegos] ${subjectPrefix}: ${opportunity.title}`;
  const recipientName = profile.name?.trim() || 'Contratista';
  const amountStr = formatCopAmount(
    opportunity.amount.amount,
    opportunity.amountKnown,
  );
  const closingDateStr = formatBogotaDate(opportunity.closingDate);
  const secopUrl = opportunity.source.originalUrl;

  const { detailText, detailHtml } = buildChangeDetails(alert, opportunity);

  const text = `Hola ${recipientName},

Se ha generado una alerta para un proceso de contratación que estás siguiendo:

• Título: ${opportunity.title}
• Entidad contratante: ${opportunity.contractingEntity.name}
• Cuantía: ${amountStr}
• Fecha de cierre (Bogotá): ${closingDateStr}

---
Detalle de la alerta:
${detailText}
---

Puedes consultar el proceso oficial en SECOP a través del siguiente enlace:
${secopUrl}

---
Para desactivar o configurar las alertas de este perfil, puedes actualizar tus preferencias en la configuración de tu perfil en Pliegos.
`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1f2937; background-color: #f9fafb; margin: 0; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <div style="background-color: #1e3a8a; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.025em;">Pliegos</h1>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0; font-size: 16px; color: #111827;">Hola <strong>${recipientName}</strong>,</p>
      <p style="margin: 0 0 20px 0; font-size: 14px; color: #4b5563;">
        Se ha registrado una novedad en un proceso que tienes en seguimiento:
      </p>

      <div style="background-color: #f3f4f6; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #111827;">${opportunity.title}</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 4px 0; color: #6b7280; width: 140px;"><strong>Entidad:</strong></td>
            <td style="padding: 4px 0; color: #111827;">${opportunity.contractingEntity.name}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280;"><strong>Cuantía:</strong></td>
            <td style="padding: 4px 0; color: #111827;">${amountStr}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280;"><strong>Fecha de cierre:</strong></td>
            <td style="padding: 4px 0; color: #111827;">${closingDateStr} (América/Bogotá)</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin-bottom: 24px; border-radius: 0 6px 6px 0;">
        ${detailHtml}
      </div>

      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${secopUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
          Ver proceso original en SECOP
        </a>
      </div>

      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

      <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
        Recibes este correo porque tienes activas las alertas para este perfil en Pliegos.<br>
        Para desactivar o configurar las alertas de este perfil, puedes actualizar tus preferencias en la configuración de tu perfil en Pliegos.
      </p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
