import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

/** Student's certificates, with how close they are to the next one. Shown on the profile. */
export default function Certificates() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/my/certificates').then(setD).catch(() => setD({ enabled: false })); }, []);
  if (!d || !d.enabled) return null;
  const c = d.next.completion; const pct = Math.min(100, Math.round((c.have / c.need) * 100));
  return (
    <section className="card pf-wide cert-mine" aria-label="Certificates">
      <h3>Certificates</h3>
      {!d.certs.length && <p className="muted">Finish mocks to earn certificates. They come with a link anyone can use to check they are real.</p>}
      {d.certs.length > 0 && <ul className="cert-list">{d.certs.map((x) => <li key={x.code} className={`k-${x.kind}`}><span className="cert-seal" aria-hidden="true">{x.kind === 'merit' ? '★' : x.kind === 'completion' ? '✓' : '✦'}</span><div><b>{x.title}</b><small className="muted">{x.detail}</small></div><Link className="btn btn-primary btn-sm" to={x.url}>Open</Link></li>)}</ul>}
      {!c.done && <div className="cert-next"><p className="small"><b>{c.need - c.have} more mock{c.need - c.have === 1 ? '' : 's'}</b> to earn the completion certificate ({c.have} of {c.need} done)</p><div className="cert-prog" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div></div>}
      {d.next.merit.best < d.next.merit.need && <p className="small muted">Score {d.next.merit.need}% or more in any mock to earn a merit certificate{d.next.merit.best ? `. Your best so far is ${d.next.merit.best}%` : ''}.</p>}
    </section>
  );
}
