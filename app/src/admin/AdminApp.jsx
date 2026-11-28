import { lazy, Suspense, useEffect, useState } from 'react';
import { PageIn } from '../components/Motion.jsx';
import BrandMark from '../components/BrandMark.jsx';
import PageNav from '../components/PageNav.jsx';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { ToastHost, Loading } from './ui.jsx';

const Overview = lazy(() => import('./Overview.jsx'));
const Users = lazy(() => import('./Users.jsx'));
const UserDetail = lazy(() => import('./UserDetail.jsx'));
const Attempts = lazy(() => import('./Attempts.jsx'));
const AttemptDetail = lazy(() => import('./AttemptDetail.jsx'));
const Exams = lazy(() => import('./Exams.jsx'));
const Mocks = lazy(() => import('./Mocks.jsx'));
const MockEditor = lazy(() => import('./MockEditor.jsx'));
const Bank = lazy(() => import('./Bank.jsx'));
const Analytics = lazy(() => import('./Analytics.jsx'));
const Reports = lazy(() => import('./Reports.jsx'));
const Settings = lazy(() => import('./Settings.jsx'));
const Live = lazy(() => import('./Live.jsx'));
const Ask = lazy(() => import('./Ask.jsx'));
const Integrity = lazy(() => import('./Integrity.jsx'));
const Coverage = lazy(() => import('./Coverage.jsx'));
const Preview = lazy(() => import('./Preview.jsx'));
const Announcements = lazy(() => import('./Announcements.jsx'));
const Notifications = lazy(() => import('./Notifications.jsx'));
const BatchHealth = lazy(() => import('./BatchHealth.jsx'));
const Desk = lazy(() => import('./Desk.jsx'));
const Certs = lazy(() => import('./Certs.jsx'));
const Quality = lazy(() => import('./Quality.jsx'));
const Cohorts = lazy(() => import('./Cohorts.jsx'));
const Messages = lazy(() => import('./Messages.jsx'));
const Content = lazy(() => import('./Content.jsx'));
const Referrals = lazy(() => import('./Referrals.jsx'));
const BatchList = lazy(() => import('./Batches.jsx').then((m) => ({ default: m.BatchList })));
const BatchDetail = lazy(() => import('./Batches.jsx').then((m) => ({ default: m.BatchDetail })));
import Search from './Search.jsx';
import { NAV_PERM } from './perms.jsx';
import { useSite } from '../lib/site.js';
const ImportStudents = lazy(() => import('./ImportStudents.jsx'));
const DataBackup = lazy(() => import('./DataBackup.jsx'));
const ControlRoom = lazy(() => import('./ControlRoom.jsx'));
const Monitoring = lazy(() => import('./Monitoring.jsx'));
const Security = lazy(() => import('./Security.jsx'));
const Abuse = lazy(() => import('./Abuse.jsx'));
const Integrations = lazy(() => import('./Integrations.jsx'));
const ServerTools = lazy(() => import('./ServerTools.jsx'));
const Calendar = lazy(() => import('./Calendar.jsx'));
const Support = lazy(() => import('./Support.jsx'));
const Alerts = lazy(() => import('./Alerts.jsx'));
const Tricks = lazy(() => import('./Tricks.jsx'));
const Help = lazy(() => import('./Help.jsx'));
const Administrators = lazy(() => import('./Administrators.jsx'));
const AuditPage = lazy(() => import('./Settings.jsx').then((m) => ({ default: m.AuditPage })));
const Assignments = lazy(() => import('./Assignments.jsx'));
import AlertBell from './AlertBell.jsx';
import QuickActions from '../components/QuickActions.jsx';

// Eight hubs instead of thirty tabs. Each hub groups related pages; every page keeps its own address.
const HUBS = [
  { id: '', label: 'Dashboard', icon: '▦', tabs: [['', 'Dashboard']] },
  { id: 'students', label: 'Students', icon: '👥', tabs: [['users', 'All students'], ['batches', 'Batches'], ['batch-health', 'Batch health'], ['cohorts', 'Cohorts'], ['assignments', 'Assignments'], ['import-students', 'Import'], ['referrals', 'Referrals'], ['certificates', 'Certificates']] },
  { id: 'tests', label: 'Tests', icon: '🗂', tabs: [['mocks', 'Mocks'], ['calendar', 'Calendar'], ['exams', 'Exams'], ['live', 'Live now'], ['attempts', 'Attempts']] },
  { id: 'questions', label: 'Questions', icon: '❓', tabs: [['bank', 'Question bank'], ['content', 'Import and AI'], ['quality', 'Quality'], ['coverage', 'Coverage'], ['tricks', 'Tricks'], ['reports', 'Student reports']] },
  { id: 'insights', label: 'Insights', icon: '📊', tabs: [['analytics', 'Analytics'], ['ask', 'Ask your data'], ['integrity', 'Integrity']] },
  { id: 'comms', label: 'Messages', icon: '📣', tabs: [['support', 'Support inbox'], ['desk', 'Doubt desk'], ['messages', 'Send a message'], ['announcements', 'Announcements'], ['notifications', 'Reminder rules']] },
  { id: 'server', label: 'Server', icon: '🖥', tabs: [['alerts', 'Alerts'], ['monitor', 'Monitoring'], ['tools', 'Server tools'], ['control', 'Control room'], ['security', 'Security'], ['abuse', 'Abuse and limits'], ['integrations', 'Integrations'], ['data', 'Data and backup']] },
  { id: 'help', label: 'Help', icon: '💬', tabs: [['help', 'Help']] },
  { id: 'settings', label: 'Settings', icon: '⚙', tabs: [['settings', 'Site configuration'], ['administrators', 'Administrators'], ['audit', 'Audit log']] },
];

function AdminNav({ hubs }) {
  const loc = useLocation(); const parts = loc.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean); if (!parts.length) return null;
  const hub = hubs.find((h) => h.tabs.some(([k]) => k === parts[0])); const tab = hub?.tabs.find(([k]) => k === parts[0]);
  const trail = [['Dashboard', '/admin']];
  if (hub && hub.tabs.length > 1) trail.push([hub.label, `/admin/${hub.tabs[0][0]}`]);
  trail.push([tab ? tab[1] : 'Page', `/admin/${parts[0]}`]);
  if (parts.length > 1) trail.push([parts[2] === 'preview' ? 'Student preview' : 'Details', loc.pathname]);
  return <PageNav trail={trail} home="/admin" />;
}

function HubTabs({ tabs, open, sup = 0 }) {
  const loc = useLocation(); const seg = loc.pathname.replace(/^\/admin\/?/, '').replace(/\/$/, '');
  if (tabs.length < 2 || !tabs.some(([k]) => k === seg)) return null; // detail pages keep their own back links
  return <nav className="ad-tabs" aria-label="Section pages">{tabs.map(([k, l]) => <NavLink key={k} to={`/admin/${k}`} className={({ isActive }) => (isActive ? 'on' : '')}>{l}{k === 'reports' && open > 0 && <span className="cnt">{open}</span>}{k === 'support' && sup > 0 && <span className="cnt">{sup}</span>}</NavLink>)}</nav>;
}

export default function AdminApp() {
  const site = useSite(); const { user, logout } = useAuth(); const [open, setOpen] = useState(0); const [sup, setSup] = useState(0); const [find, setFind] = useState(false); const loc = useLocation();
  useEffect(() => { const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setFind(true); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  useEffect(() => { if (user?.role === 'admin' || user?.role === 'editor') { const f = () => api.get('/admin/reports?status=open').then((d) => setOpen(d.open ?? d.reports?.length ?? 0)).catch(() => {}); f(); window.addEventListener('ad-reports', f); const t = setInterval(f, 60000); return () => { window.removeEventListener('ad-reports', f); clearInterval(t); }; } }, [user]);
  useEffect(() => { if (user?.role !== 'admin' && user?.role !== 'editor') return undefined; const f = () => api.get('/admin/tickets?status=open').then((d) => setSup(d.counts?.open || 0)).catch(() => {}); f(); const t = setInterval(f, 60000); return () => clearInterval(t); }, [user?.role, loc.pathname]);
  const editor = user?.role === 'editor';
  if (user?.role !== 'admin' && !editor) return <Navigate to="/" replace />;
  const perms = editor ? user.perms || ['content'] : null;
  const can = (k) => !editor || perms.includes(NAV_PERM[k]);
  const hubs = HUBS.map((h) => ({ ...h, tabs: h.tabs.filter(([k]) => can(k)) })).filter((h) => h.tabs.length);
  const seg = loc.pathname.replace(/^\/admin\/?/, '').split('/')[0];
  const hubOf = (h) => h.tabs.some(([k]) => k === seg);
  
  return (
    <div className="ad">
      <aside className="ad-side">
        <Link to="/admin" className="ad-brand"><BrandMark /><span>{site.name}<small>{editor ? 'Staff' : 'Admin'}</small></span></Link>
        <nav className="ad-nav" aria-label="Admin">
          {hubs.map((h) => <Link key={h.id} to={`/admin${h.tabs[0][0] ? '/' + h.tabs[0][0] : ''}`} className={hubOf(h) ? 'active' : ''} aria-current={hubOf(h) ? 'page' : undefined}><span className="ico" aria-hidden="true">{h.icon}</span>{h.label}{h.id === 'questions' && open > 0 && <span className="cnt">{open}</span>}</Link>)}
        </nav>
        <div className="ad-side-foot"><span>Signed in as <b>{user.name}</b><br /><small>{user.email}</small></span><button className="btn btn-ghost btn-sm" onClick={logout} style={{ color: '#fff', borderColor: 'rgba(255,255,255,.3)', background: 'transparent' }}>Sign out</button></div>
      </aside>
      <main className="ad-main" id="main">
        <div className="ad-top"><button className="ad-find" onClick={() => setFind(true)} aria-label="Search everything"><span aria-hidden="true">🔍</span><span className="ad-find-t">Search users, mocks, questions…</span><kbd>Ctrl K</kbd></button><span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Link className="btn btn-ghost btn-sm ad-help-btn" to={`/admin/help?from=${encodeURIComponent(loc.pathname)}`} aria-label="Open Help"><span aria-hidden="true">💬</span> Help</Link>{!editor && <AlertBell />}<ThemeToggle /><button className="btn btn-ghost btn-sm ad-out" onClick={logout}>Sign out</button></span></div>
        <AdminNav hubs={hubs} />
        <HubTabs tabs={(hubs.find(hubOf) || { tabs: [] }).tabs} open={open} sup={sup} />
        <Suspense fallback={<Loading />}>
          <PageIn><Routes>
            <Route index element={editor && !perms.includes('students') ? <Navigate to="/admin/mocks" replace /> : <Overview />} />
            <Route path="users" element={<Users />} />
            <Route path="users/:id" element={<UserDetail />} />
            <Route path="attempts" element={<Attempts />} />
            <Route path="attempts/:id" element={<AttemptDetail />} />
            <Route path="exams" element={<Exams />} />
            <Route path="mocks" element={<Mocks />} />
            <Route path="mocks/:id" element={<MockEditor />} />
            <Route path="mocks/:id/preview" element={<Preview />} />
            <Route path="live" element={<Live />} />
            <Route path="ask" element={<Ask />} />
            <Route path="integrity" element={<Integrity />} />
            <Route path="anomalies" element={<Navigate to="/admin/integrity" replace />} />
            <Route path="import-students" element={<ImportStudents />} />
            <Route path="data" element={<DataBackup />} />
            <Route path="coverage" element={<Coverage />} />
            <Route path="system" element={<Navigate to="/admin/tools" replace />} />
            <Route path="control" element={<ControlRoom />} />
            <Route path="tools" element={<ServerTools />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="support" element={<Support />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="administrators" element={<Administrators />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="team" element={<Navigate to="/admin/administrators" replace />} />
            <Route path="help" element={<Help />} />
            <Route path="tricks" element={<Tricks />} />
            <Route path="assignments" element={<Assignments />} />
            <Route path="monitor" element={<Monitoring />} />
            <Route path="security" element={<Security />} />
            <Route path="abuse" element={<Abuse />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="bank" element={<Bank />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="reports" element={<Reports />} />
            <Route path="quality" element={<Quality />} />
            <Route path="cohorts" element={<Cohorts />} />
            <Route path="messages" element={<Messages />} />
            <Route path="content" element={<Content />} />
            <Route path="batches" element={<BatchList />} />
            <Route path="batches/:id" element={<BatchDetail />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="batch-health" element={<BatchHealth />} />
            <Route path="desk" element={<Desk />} />
            <Route path="certificates" element={<Certs />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes></PageIn>
        </Suspense>
      </main>
      {find && <Search onClose={() => setFind(false)} />}
      <ToastHost />
      <QuickActions role="admin" />
    </div>
  );
}
