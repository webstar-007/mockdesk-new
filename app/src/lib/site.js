import { useEffect, useState } from 'react';
import { api } from './api.js';

// The site name, tagline and contact come from Admin > Settings. These values show until they arrive.
export const SITE_FALLBACK = { name: 'MockDesk', tagline: 'Online mock tests for government exams', heroTitle: '', heroText: '', supportEmail: '', supportPhone: '', disclaimer: '', faq: [], logoUrl: '', accent: '', footerText: '' };
let cache = null; let pending = null; const listeners = new Set();
function load() {
  if (!pending) pending = api.get('/public/site').then((s) => { cache = { ...SITE_FALLBACK, ...s }; listeners.forEach((f) => f(cache)); }).catch(() => { pending = null; });
  return pending;
}
if (typeof window !== 'undefined') window.addEventListener('md-maint', (e) => { cache = { ...(cache || SITE_FALLBACK), maintenance: 'hard', maintenanceMessage: e.detail || '' }; listeners.forEach((f) => f(cache)); });
export const refreshSite = () => { cache = null; pending = null; return load(); };
export function useSite() {
  const [s, set] = useState(cache || SITE_FALLBACK);
  useEffect(() => { listeners.add(set); if (!cache) load(); else set(cache); return () => listeners.delete(set); }, []);
  useEffect(() => { document.title = `${s.name}${s.tagline ? ` · ${s.tagline}` : ''}`; }, [s.name, s.tagline]);
  useEffect(() => {
    const r = document.documentElement.style;
    if (s.accent) { r.setProperty('--brand', s.accent); r.setProperty('--brand-2', `color-mix(in srgb, ${s.accent} 82%, #fff)`); r.setProperty('--brand-soft', `color-mix(in srgb, ${s.accent} 12%, var(--surface))`); } else ['--brand', '--brand-2', '--brand-soft'].forEach((k) => r.removeProperty(k));
    const link = document.querySelector('link[rel="icon"]');
    if (link) { if (!link.dataset.orig) link.dataset.orig = link.href; link.href = s.logoUrl || link.dataset.orig; }
  }, [s.accent, s.logoUrl]);
  return s;
}
