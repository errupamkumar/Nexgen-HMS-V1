import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, MessageSquare, Phone, Send, X } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useFmt } from '@/lib/format';
import type { Paged, PatientRow } from '@/lib/types';
import { Badge, Button, Card, Checkbox, Input, Textarea } from '@/components/ui';
import { DataTable, EmptyState, Field, PageHeader, Pagination, PatientPicker, SectionCard, StatusBadge } from '@/components/common';

interface Log {
  id: number;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  status: string;
  createdAt: string;
  patientName: string | null;
  uhid: string | null;
  sentByName: string | null;
}

const TEMPLATES = [
  ['Doctor delayed', 'Dear {name}, your doctor is running about 30 minutes late today. We regret the inconvenience.'],
  ['Clinic closed', 'Dear {name}, the clinic will remain closed tomorrow. Your appointment will be rescheduled — we will call you.'],
  ['Report ready', 'Dear {name}, your lab report is ready. Please collect it or view it in the patient portal.'],
  ['Follow-up reminder', 'Dear {name} ({uhid}), this is a reminder for your follow-up visit. Call us to book a slot.'],
];

export default function MessagesPage() {
  const f = useFmt();
  const qc = useQueryClient();
  const [recipients, setRecipients] = useState<PatientRow[]>([]);
  const [channels, setChannels] = useState<string[]>(['sms']);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [page, setPage] = useState(1);
  const log = useQuery({ queryKey: ['messages', page], queryFn: () => api.get<Paged<Log>>('/messages', { page, pageSize: 15 }), placeholderData: keepPreviousData });
  const send = useMutation({
    mutationFn: () => api.post<{ recipients: number; sent: number; skipped: number }>('/messages', { patientIds: recipients.map((r) => r.id), channels, subject: subject || undefined, body }),
    onSuccess: (r) => {
      toast.success(`Sent ${r.sent} message(s) to ${r.recipients} patient(s)`, { description: r.skipped ? `${r.skipped} skipped — no address on file for that channel` : undefined });
      setRecipients([]);
      setBody('');
      setSubject('');
      qc.invalidateQueries({ queryKey: ['messages'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <>
      <PageHeader icon={MessageSquare} title="Messages" description="Notify patients by SMS, WhatsApp or email. Placeholders: {name}, {uhid}" />
      <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-[420px_1fr]">
        <SectionCard title="Compose">
          <div className="flex flex-col gap-4">
            <Field label="Recipients">
              <PatientPicker value={null} onChange={(p) => p && !recipients.some((r) => r.id === p.id) && setRecipients([...recipients, p])} />
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((r) => (
                  <Badge key={r.id} variant="secondary" className="gap-1">
                    {r.name}
                    <button className="cursor-pointer" onClick={() => setRecipients(recipients.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.name}`}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </Field>
            <Field label="Channels">
              <div className="flex gap-4">
                {[
                  ['sms', 'SMS', Phone],
                  ['whatsapp', 'WhatsApp', MessageSquare],
                  ['email', 'Email', Mail],
                ].map(([k, l, Icon]) => {
                  const I = Icon as typeof Phone;
                  return (
                    <label key={k as string} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={channels.includes(k as string)} onCheckedChange={(c) => setChannels(c ? [...channels, k as string] : channels.filter((x) => x !== k))} />
                      <I className="size-4 text-muted-foreground" /> {l as string}
                    </label>
                  );
                })}
              </div>
            </Field>
            {channels.includes('email') ? (
              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
            ) : null}
            <Field label="Message" hint={`${body.length}/1000`}>
              <Textarea rows={5} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map(([l, t]) => (
                <button key={l} type="button" onClick={() => setBody(t)} className="cursor-pointer rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition hover:border-primary hover:text-primary">
                  {l}
                </button>
              ))}
            </div>
            <Button disabled={!recipients.length || !channels.length || body.trim().length < 2} loading={send.isPending} onClick={() => send.mutate()}>
              <Send /> Send to {recipients.length || 0} patient(s)
            </Button>
          </div>
        </SectionCard>
        <Card>
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Delivery log</h3>
            <p className="text-xs text-muted-foreground">Gateways are simulated in this release — messages are recorded, not sent.</p>
          </div>
          <DataTable
            rows={log.data?.data}
            loading={log.isLoading}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={MessageSquare} title="No messages sent yet" />}
            columns={[
              { key: 't', header: 'When', cell: (r) => <span className="whitespace-nowrap text-xs">{f.dateTime(r.createdAt)}</span> },
              {
                key: 'p',
                header: 'To',
                cell: (r) => (
                  <div>
                    <p className="font-medium">{r.patientName ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{r.recipient}</p>
                  </div>
                ),
              },
              { key: 'c', header: 'Channel', cell: (r) => <Badge variant="secondary">{r.channel.toUpperCase()}</Badge> },
              { key: 'b', header: 'Message', cell: (r) => <span className="line-clamp-2 max-w-md text-xs">{r.body}</span>, className: 'hidden md:table-cell' },
              { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
          {log.data ? <Pagination page={page} pageSize={log.data.pageSize} total={log.data.total} onPage={setPage} /> : null}
        </Card>
      </div>
    </>
  );
}
