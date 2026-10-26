import { useEffect, useState } from 'react';
import { CalendarDays, ChefHat, Users, Settings, LogOut, KeyRound, UtensilsCrossed, ShieldCheck, Soup, FileSpreadsheet } from 'lucide-react';
import { api, session } from './api.js';
import Login from './Login.jsx';
import OrdersView from './OrdersView.jsx';
import KitchenView from './KitchenView.jsx';
import StudentsView from './StudentsView.jsx';
import { UsersView, SettingsView } from './AdminView.jsx';
import MenuView from './MenuView.jsx';
import ReportView from './ReportView.jsx';
import MyMealsView from './MyMealsView.jsx';
import PasswordDialog from './PasswordDialog.jsx';
import { ROLE_NAME } from './meals.js';

// Each tab is shown to whoever holds the right (the server checks the same rights)
const TABS = [
  { id: 'my', label: 'Moji obroki', icon: Soup, show: me => me.user.role === 'student' },
  { id: 'orders', label: 'Naročila', icon: CalendarDays, right: 'orders' },
  { id: 'menu', label: 'Jedilnik', icon: UtensilsCrossed, show: me => me.user.role === 'student' || me.rights.includes('viewMenu') },
  { id: 'kitchen', label: 'Kuhinja', icon: ChefHat, right: 'kitchen' },
  { id: 'report', label: 'Mesečni pregled', icon: FileSpreadsheet, right: 'report' },
  { id: 'students', label: 'Dijaki', icon: Users, right: 'diets' },
  { id: 'users', label: 'Uporabniki', icon: ShieldCheck, right: 'users' },
  { id: 'settings', label: 'Nastavitve', icon: Settings, show: me => me.rights.includes('mealSettings') || me.rights.includes('system') },
];

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(!!session.token);
  const [tab, setTab] = useState(() => sessionStorage.getItem('tab') || '');
  const [pwOpen, setPwOpen] = useState(false);

  const loadMe = () => api('me').then(setMe);
  const signOut = () => { session.token = null; sessionStorage.removeItem('tab'); setMe(null); };

  useEffect(() => {
    const out = () => setMe(null);
    window.addEventListener('signed-out', out);
    if (session.token) loadMe().catch(() => setMe(null)).finally(() => setLoading(false));
    return () => window.removeEventListener('signed-out', out);
  }, []);

  useEffect(() => { if (tab) sessionStorage.setItem('tab', tab); }, [tab]);

  if (loading) return <div className="boot">Nalaganje …</div>;
  if (!me) return <Login onSignedIn={loadMe} />;

  const has = r => me.rights.includes(r);
  const tabs = TABS.filter(t => (t.show ? t.show(me) : has(t.right)));
  const active = tabs.find(t => t.id === tab) || tabs[0];
  const student = me.user.role === 'student';

  return (
    <div className={student ? 'shell student-shell' : 'shell'}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Dom<em>Obroki</em></span>
        </div>
        <nav className="tabs">
          {tabs.map(t => (
            <button key={t.id} className={t.id === active?.id ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
              <t.icon size={16} strokeWidth={2} /> {t.label}
            </button>
          ))}
        </nav>
        <div className="who">
          <span className="who-name">{me.user.name}<small>{ROLE_NAME[me.user.role]}</small></span>
          <button className="icon-btn" title="Spremeni geslo" onClick={() => setPwOpen(true)}><KeyRound size={16} /></button>
          <button className="icon-btn" title="Odjava" onClick={signOut}><LogOut size={16} /></button>
        </div>
      </header>
      <main className="main">
        {!active && <p className="muted pad">Vaš račun nima dostopa do nobenega dela aplikacije. Obrnite se na skrbnika.</p>}
        {active?.id === 'my' && <MyMealsView me={me} />}
        {active?.id === 'orders' && <OrdersView clock={me.clock} me={me} />}
        {active?.id === 'menu' && <MenuView clock={me.clock} canEdit={has('menu')} />}
        {active?.id === 'kitchen' && <KitchenView clock={me.clock} />}
        {active?.id === 'report' && <ReportView me={me} />}
        {active?.id === 'students' && <StudentsView me={me} />}
        {active?.id === 'users' && <UsersView me={me} />}
        {active?.id === 'settings' && <SettingsView me={me} />}
      </main>
      {me.user.must_change
        ? <PasswordDialog forced onChanged={loadMe} onSignOut={signOut} />
        : pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </div>
  );
}
