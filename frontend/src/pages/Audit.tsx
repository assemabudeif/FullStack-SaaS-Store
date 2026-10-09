import { useState } from 'react';
import { Activity, ArrowDownToLine, ChevronDown, FileClock } from 'lucide-react';
import { useApi } from '../lib/hooks';
import type { Audit as AuditRecord, List, Member } from '../types';
import { date, downloadCsv, humanAction, initials, shortId } from '../lib/utils';
import { Badge, Button, Empty, PageHeader, Pagination, Panel, QueryState } from '../components/ui';

export default function Audit() {
  const [page, setPage] = useState(1), [expanded, setExpanded] = useState<string | null>(null), query = useApi<List<AuditRecord>>(`/audit-logs?limit=20&page=${page}`), members = useApi<List<Member>>('/members');
  const rows = query.data?.data ?? [];
  return <><PageHeader eyebrow="A LITTLE ACCOUNTABILITY" title="Activity log" description="The story of your workspace, one considered change at a time." actions={<Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv('activity-page', rows.map((a) => ({ action: a.action, actor: a.actor_id, entity: a.entity_id, date: a.created_at, details: JSON.stringify(a.details) })))}><ArrowDownToLine size={16} />Export page</Button>} /><div className="audit-intro"><FileClock size={22} /><p>Important store changes are logged in the same transaction as the change itself.</p><Badge tone="green">Transactional audit</Badge></div>
    <Panel><QueryState query={query}>{rows.length ? <div className="audit-list">{rows.map((a) => {
      const member = members.data?.data.find((m) => m.id === a.actor_id);
      return <article key={a.id}><span className="audit-symbol"><Activity size={18} /></span><div className="audit-content"><div><strong className="capitalize">{humanAction(a.action)}</strong><Badge>{a.action.split('.')[0]}</Badge></div><p><span className="audit-avatar">{initials(member?.name ?? 'Unknown')}</span>{member?.name ?? shortId(a.actor_id)}<span className="audit-divider">·</span>{date(a.created_at, true)}</p><span className="audit-reference">Reference {a.entity_id ? shortId(a.entity_id) : 'not supplied'}</span>{expanded === a.id ? <pre>{JSON.stringify(a.details, null, 2)}</pre> : null}</div><button className="icon-button" aria-label={`View details for ${a.action}`} aria-expanded={expanded === a.id} onClick={() => setExpanded(expanded === a.id ? null : a.id)}><ChevronDown size={17} /></button></article>;
    })}</div> : <Empty title="A fresh chapter." description="Store changes will appear here as your team gets to work." />}<Pagination page={page} limit={20} total={query.data?.total} count={rows.length} onChange={setPage} /></QueryState></Panel>
  </>;
}
