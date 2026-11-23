import { Link } from 'react-router-dom';
import { Badge, Empty, Err, Loading, PageHead, dt, useLoad } from './ui.jsx';

// Read-only view for admins of every assignment teachers have set.
export default function Assignments() {
  const { data: d, err, loading } = useLoad('/admin/assignments');
  if (loading && !d) return <Loading />; if (err) return <Err>{err}</Err>;
  return (
    <>
      <PageHead title="Assignments" sub="Mocks and practice that teachers set for their batches." />
      {d.items.length ? <div className="ad-tablewrap"><table className="ad-table"><thead><tr><th>Assignment</th><th>Batch</th><th>Teacher</th><th>Due</th><th>Finished</th><th>Pending</th></tr></thead><tbody>
        {d.items.map((a) => <tr key={a.id}><td><b>{a.title}</b><br /><small className="muted">{a.kind === 'practice' ? 'Practice sets' : 'Mock'}</small></td><td><Link to={`/admin/batches/${a.batchId}`}>{a.batch}</Link></td><td>{a.teacher}</td><td>{dt(a.dueAt)} {a.overdue && <Badge tone="bad">Past due</Badge>}</td><td>{a.done} of {a.total}{a.late > 0 && <small className="muted"> ({a.late} late)</small>}</td><td>{a.pending}</td></tr>)}
      </tbody></table></div> : <Empty>No assignments yet. Teachers set them from their own dashboard.</Empty>}
    </>
  );
}
