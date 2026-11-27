import { useCallback, useEffect, useRef, useState } from 'react';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: layout just will not be remembered */ } };

/** Order, hidden and collapsed blocks, remembered per person on this device. */
export function useLayout(key, ids) {
  const [lay, setLay] = useState(() => { const s = read(key) || {}; const known = ids.filter((i) => !(s.order || []).includes(i)); return { order: [...(s.order || []).filter((i) => ids.includes(i)), ...known], hidden: (s.hidden || []).filter((i) => ids.includes(i)), collapsed: (s.collapsed || []).filter((i) => ids.includes(i)) }; });
  const save = useCallback((fn) => setLay((l) => { const n = fn(l); write(key, n); return n; }), [key]);
  return [lay, save, () => { write(key, null); setLay({ order: ids, hidden: [], collapsed: [] }); }];
}

/** Blocks the person can reorder, collapse and hide. Empty blocks (null) take no room. */
export function BlockBoard({ uid, ids: defs, nodes }) {
  const ids = defs.map((d) => d[0]); const label = Object.fromEntries(defs);
  const [lay, save, reset] = useLayout(`md-blocks-${uid}`, ids); const [edit, setEdit] = useState(false); const [drag, setDrag] = useState(null); const [over, setOver] = useState(null); const live = useRef(null);
  const say = (t) => { if (live.current) live.current.textContent = t; };
  const move = (id, dir) => save((l) => { const o = [...l.order]; const i = o.indexOf(id); const j = i + dir; if (j < 0 || j >= o.length) return l; [o[i], o[j]] = [o[j], o[i]]; say(`${label[id]} moved to position ${j + 1}`); return { ...l, order: o }; });
  const drop = (to) => { if (drag && drag !== to) save((l) => { const o = l.order.filter((x) => x !== drag); o.splice(o.indexOf(to), 0, drag); return { ...l, order: o }; }); setDrag(null); setOver(null); };
  const toggle = (id, k) => save((l) => ({ ...l, [k]: l[k].includes(id) ? l[k].filter((x) => x !== id) : [...l[k], id] }));
  useEffect(() => { if (!edit) return undefined; const k = (e) => { if (e.key === 'Escape') setEdit(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [edit]);
  const shown = lay.order.filter((i) => !lay.hidden.includes(i) && (nodes[i] || edit));
  const hiddenList = lay.order.filter((i) => lay.hidden.includes(i) && nodes[i]);
  const custom = lay.hidden.length > 0 || lay.order.join() !== ids.join() || lay.collapsed.length > 0;
  return (
    <div className={`bb ${edit ? 'editing' : ''}`}>
      <div className="bb-bar"><button type="button" className={`btn btn-ghost btn-sm ${edit ? 'on' : ''}`} aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Customize layout'}</button>{edit && <><span className="muted small">Drag a block, or use the arrows. Hide what you do not need.</span>{custom && <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Reset</button>}</>}</div>
      <div className="sr-only" role="status" ref={live} />
      {shown.map((id) => {
        const col = lay.collapsed.includes(id) && !edit; const i = lay.order.indexOf(id);
        return (
          <section key={id} className={`bb-blk ${col ? 'collapsed' : ''} ${drag === id ? 'dragging' : ''} ${over === id ? 'over' : ''}`} draggable={edit} onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrag(null); setOver(null); }} onDragOver={(e) => { if (edit && drag) { e.preventDefault(); setOver(id); } }} onDrop={(e) => { e.preventDefault(); drop(id); }} aria-label={label[id]}>
            {edit ? (
              <div className="bb-tools"><span className="bb-grip" aria-hidden="true">⠿</span><b>{label[id]}</b>{!nodes[id] && <em className="muted small">Nothing to show right now</em>}
                <span className="bb-btns"><button type="button" aria-label={`Move ${label[id]} up`} disabled={i === 0} onClick={() => move(id, -1)}>↑</button><button type="button" aria-label={`Move ${label[id]} down`} disabled={i === lay.order.length - 1} onClick={() => move(id, 1)}>↓</button><button type="button" onClick={() => toggle(id, 'collapsed')} aria-pressed={lay.collapsed.includes(id)}>{lay.collapsed.includes(id) ? 'Start open' : 'Start folded'}</button><button type="button" onClick={() => toggle(id, 'hidden')}>Hide</button></span></div>
            ) : (nodes[id] && <button type="button" className="bb-fold" aria-expanded={!col} aria-label={`${col ? 'Show' : 'Fold'} ${label[id]}`} onClick={() => toggle(id, 'collapsed')}><i aria-hidden="true" /></button>)}
            {col ? <p className="bb-folded muted small">{label[id]} is folded. <button type="button" className="lx-link" onClick={() => toggle(id, 'collapsed')}>Show</button></p> : <div className="bb-body">{nodes[id]}</div>}
          </section>
        );
      })}
      {edit && hiddenList.length > 0 && <div className="bb-hidden"><b>Hidden</b>{hiddenList.map((id) => <button key={id} type="button" className="chip" onClick={() => toggle(id, 'hidden')}>+ {label[id]}</button>)}</div>}
    </div>
  );
}
