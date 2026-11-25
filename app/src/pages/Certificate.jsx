import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const when = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
function draw(canvas, c, url) {
  const W = 1600, H = 1131; const x = canvas.getContext('2d'); canvas.width = W; canvas.height = H;
  x.fillStyle = '#fffdf7'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#1e3a8a'; x.lineWidth = 14; x.strokeRect(40, 40, W - 80, H - 80); x.strokeStyle = '#c9a227'; x.lineWidth = 4; x.strokeRect(68, 68, W - 136, H - 136);
  x.textAlign = 'center'; x.fillStyle = '#1e3a8a'; x.font = '600 34px Georgia, serif'; x.fillText(c.org.toUpperCase(), W / 2, 190);
  x.fillStyle = '#0f172a'; x.font = '700 76px Georgia, serif'; x.fillText(c.title, W / 2, 330);
  x.fillStyle = '#475569'; x.font = 'italic 32px Georgia, serif'; x.fillText('This certifies that', W / 2, 440);
  x.fillStyle = '#1e3a8a'; x.font = '700 112px Georgia, serif'; x.fillText(c.name, W / 2, 580);
  x.strokeStyle = '#c9a227'; x.lineWidth = 3; x.beginPath(); x.moveTo(W / 2 - 360, 614); x.lineTo(W / 2 + 360, 614); x.stroke();
  x.fillStyle = '#334155'; x.font = '36px Georgia, serif'; x.fillText(c.detail || '', W / 2, 705);
  x.font = '30px Georgia, serif'; x.fillStyle = '#475569'; x.fillText(`Issued on ${when(c.issuedAt)}`, W / 2, 780);
  if (c.signerName) { x.strokeStyle = '#64748b'; x.lineWidth = 2; x.beginPath(); x.moveTo(W - 520, 930); x.lineTo(W - 180, 930); x.stroke(); x.fillStyle = '#0f172a'; x.font = '600 30px Georgia, serif'; x.fillText(c.signerName, W - 350, 972); x.fillStyle = '#64748b'; x.font = '24px Georgia, serif'; x.fillText(c.signerTitle || '', W - 350, 1008); }
  x.textAlign = 'left'; x.fillStyle = '#64748b'; x.font = '24px ui-monospace, monospace'; x.fillText(`Certificate ${c.code}`, 130, 972); x.fillText(`Verify: ${url}`.slice(0, 70), 130, 1008);
}

/** Public certificate page: anyone with the code can see it and check it is real. */
export default function Certificate() {
  const { code } = useParams(); const [c, setC] = useState(null); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false); const cv = useRef(null);
  useEffect(() => { api.get(`/public/certificate/${encodeURIComponent(code)}`).then(setC).catch((e) => setErr(e.message)); }, [code]);
  const url = `${window.location.origin}/c/${code}`;
  function png() { const cnv = cv.current; draw(cnv, c, url); const a = document.createElement('a'); a.download = `certificate-${c.code}.png`; a.href = cnv.toDataURL('image/png'); a.click(); }
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ } }
  if (err) return <main className="cert-page"><div className="card cert-bad"><h1>Certificate not found</h1><p>{err}</p><Link className="btn btn-primary" to="/">Go to the home page</Link></div></main>;
  if (!c) return <main className="cert-page"><p className="muted" role="status">Loading…</p></main>;
  return (
    <main className="cert-page">
      <div className="cert-tools no-print">
        <span className={`cert-valid ${c.valid ? 'ok' : 'no'}`} role="status">{c.valid ? '✓ Verified. This certificate is genuine.' : 'This certificate has been withdrawn and is no longer valid.'}</span>
        <div><button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print or save as PDF</button> <button className="btn btn-ghost btn-sm" onClick={png}>Download image</button> <a className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`I earned the ${c.title} at ${c.org}. Check it here: ${url}`)}`}>Share on WhatsApp</a> <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button></div>
      </div>
      <article className={`cert-sheet ${c.valid ? '' : 'void'}`} aria-label={`${c.title} for ${c.name}`}>
        <div className="cert-frame">
          <p className="cert-org">{c.org}</p>
          <h1 className="cert-title">{c.title}</h1>
          <p className="cert-this">This certifies that</p>
          <p className="cert-name">{c.name}</p>
          <p className="cert-detail">{c.detail}</p>
          <p className="cert-date">Issued on {when(c.issuedAt)}</p>
          <footer><div className="cert-code"><span>Certificate {c.code}</span><small>Verify at {url.replace(/^https?:\/\//, '')}</small></div>{c.signerName && <div className="cert-sign"><span>{c.signerName}</span><small>{c.signerTitle}</small></div>}</footer>
          {!c.valid && <div className="cert-void">WITHDRAWN</div>}
        </div>
      </article>
      <canvas ref={cv} hidden />
    </main>
  );
}
