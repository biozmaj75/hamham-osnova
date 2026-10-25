import { useEffect, useState } from 'react';
import { CalendarDays, ChefHat, Users, Settings, LogOut, KeyRound } from 'lucide-react';
import { api, session } from './api.js';
import Login from './Login.jsx';
import OrdersView from './OrdersView.jsx';
import KitchenView from './KitchenView.jsx';
import StudentsView from './StudentsView.jsx';
import AdminView from './AdminView.jsx';
import PasswordDialog from './PasswordDialog.jsx';

const TABS = [
  { id: 'orders', label: 'Orders', icon: CalendarDays, roles: ['admin', 'teacher'] },
  { id: 'kitchen', label: 'Kitchen', icon: ChefHat, roles: ['admin', 'teacher', 'kitchen'] },
  { id: 'students', label: 'Students', icon: Users, roles: ['admin', 'teacher'] },
  { id: 'admin', label: 'Administration', icon: Settings, roles: ['admin'] },
];

const ROLE_NAME = { admin: 'Administrator', teacher: 'Teacher', kitchen: 'Kitchen' };

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(!!session.token);
  const [tab, setTab] = useState(() => sessionStorage.getItem('tab') || '');
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    const out = () => setMe(null);
    window.addEventListener('signed-out', out);
    if (session.token) {
      api('me').then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
    }
    return () => window.removeEventListener('signed-out', out);
  }, []);

  useEffect(() => { if (tab) sessionStorage.setItem('tab', tab); }, [tab]);

  if (loading) return <div className="boot">Loading…</div>;
  if (!me) return <Login onSignedIn={async () => setMe(await api('me'))} />;

  const tabs = TABS.filter(t => t.roles.includes(me.user.role));
  const active = tabs.find(t => t.id === tab) || tabs[0];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Dorm<em>Meals</em></span>
        </div>
        <nav className="tabs">
          {tabs.map(t => (
            <button key={t.id} className={t.id === active.id ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
              <t.icon size={16} strokeWidth={2} /> {t.label}
            </button>
          ))}
        </nav>
        <div className="who">
          <span className="who-name">{me.user.name}<small>{ROLE_NAME[me.user.role]}</small></span>
          <button className="icon-btn" title="Change password" onClick={() => setPwOpen(true)}><KeyRound size={16} /></button>
          <button className="icon-btn" title="Sign out" onClick={() => { session.token = null; setMe(null); }}><LogOut size={16} /></button>
        </div>
      </header>
      <main className="main">
        {active.id === 'orders' && <OrdersView clock={me.clock} />}
        {active.id === 'kitchen' && <KitchenView clock={me.clock} />}
        {active.id === 'students' && <StudentsView />}
        {active.id === 'admin' && <AdminView me={me.user} />}
      </main>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </div>
  );
}
