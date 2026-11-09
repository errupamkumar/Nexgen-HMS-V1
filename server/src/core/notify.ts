/**
 * In-app notifications and outbound patient messages.
 *
 * Outbound channels (SMS / email / WhatsApp) are SIMULATED in R1: the message
 * is recorded with status `simulated`. Swapping in a real provider means
 * replacing `deliver()` only.
 */
import type { DbOrTx } from '../db/client.js';
import { messageLogs, notifications } from '../db/schema.js';
import { logger } from './logger.js';
import type { TenantSettings } from './settings.js';

export async function notify(
  tx: DbOrTx,
  tenantId: number,
  n: { title: string; body?: string; link?: string; type?: string; userId?: number | null; permission?: string | null },
) {
  try {
    await tx.insert(notifications).values({
      tenantId,
      title: n.title.slice(0, 150),
      body: n.body?.slice(0, 500) ?? null,
      link: n.link ?? null,
      type: n.type ?? 'info',
      userId: n.userId ?? null,
      permission: n.permission ?? null,
      readBy: [],
    });
  } catch (err) {
    logger.error({ err }, 'notification insert failed');
  }
}

type Channel = 'sms' | 'email' | 'whatsapp' | 'portal';

async function deliver(_channel: Channel, _recipient: string, _subject: string | null, _body: string): Promise<'sent' | 'simulated' | 'failed'> {
  return 'simulated';
}

export async function sendPatientMessage(
  tx: DbOrTx,
  tenantId: number,
  settings: TenantSettings,
  m: { patientId: number; phone?: string | null; email?: string | null; subject?: string | null; body: string; sentBy?: number | null; channels?: Channel[] },
) {
  const wanted: Channel[] =
    m.channels ??
    ([
      settings.notifications.smsEnabled && 'sms',
      settings.notifications.whatsappEnabled && 'whatsapp',
      settings.notifications.emailEnabled && 'email',
    ].filter(Boolean) as Channel[]);
  const results: { channel: Channel; recipient: string; status: string }[] = [];
  for (const channel of wanted) {
    const recipient = channel === 'email' ? m.email : channel === 'portal' ? String(m.patientId) : m.phone;
    if (!recipient) continue;
    const status = await deliver(channel, recipient, m.subject ?? null, m.body);
    await tx.insert(messageLogs).values({
      tenantId,
      patientId: m.patientId,
      channel,
      recipient,
      subject: m.subject ?? null,
      body: m.body,
      status,
      sentBy: m.sentBy ?? null,
    });
    results.push({ channel, recipient, status });
  }
  return results;
}
