import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, Bell, CalendarDays, CheckCircle2, Circle, Clock3,
  Compass, Filter, Mail, MapPin, MoreHorizontal, MountainSnow, Phone, Search,
  Send, SlidersHorizontal, Sparkles, Star, TrendingUp,
  Users, X, Zap,
} from 'lucide-react';

type Contact = {
  id: number;
  name: string;
  initials: string;
  city: string;
  segment: string;
  ltv: number;
  lastTrip: string;
  lastDate: string;
  status: 'Booked' | 'Opened' | 'Sent' | 'Not sent';
  open: number;
  tier: 'Summit' | 'Ridge' | 'Trail';
  priority: 'Today' | 'Soon' | 'Later';
  action: string;
  coach?: string;
};

const CONTACTS: Contact[] = [
  { id: 1, name: 'Ingrid Halvorsen', initials: 'IH', city: 'Oslo, Norway', segment: 'Returning Voyager', ltv: 18420, lastTrip: 'Kyoto Ryokan Circuit', lastDate: 'Apr 2025', status: 'Booked', open: 4, tier: 'Summit', priority: 'Today', action: 'Send a personal note before 10:30', coach: 'Reconnect around the quiet details she loved in Kyoto.' },
  { id: 2, name: 'Tomas Eriksen', initials: 'TE', city: 'Copenhagen, DK', segment: 'High Intent', ltv: 9210, lastTrip: 'Hokkaidō Powder Week', lastDate: 'Feb 2025', status: 'Opened', open: 2, tier: 'Ridge', priority: 'Today', action: 'Call to answer his family itinerary question', coach: 'Lead with the two-route comparison, then ask who needs to feel confident.' },
  { id: 3, name: 'Aiko Tanabe', initials: 'AT', city: 'Kanazawa, Japan', segment: 'Returning Voyager', ltv: 24650, lastTrip: 'Lofoten Midnight Sun', lastDate: 'Jun 2025', status: 'Booked', open: 6, tier: 'Summit', priority: 'Today', action: 'Confirm the final room preference', coach: 'Make this feel like a thoughtful handoff, not another form to complete.' },
  { id: 4, name: 'Marcus Lindqvist', initials: 'ML', city: 'Stockholm, SE', segment: 'Dormant', ltv: 4180, lastTrip: 'Setouchi Art Islands', lastDate: 'Oct 2023', status: 'Sent', open: 0, tier: 'Trail', priority: 'Later', action: 'Revisit after the Equinox campaign', },
  { id: 5, name: 'Clara Nørgaard', initials: 'CN', city: 'Aarhus, DK', segment: 'High Intent', ltv: 7340, lastTrip: 'Tōhoku Onsen Trail', lastDate: 'Nov 2024', status: 'Opened', open: 3, tier: 'Ridge', priority: 'Soon', action: 'Share the slower Tōhoku alternative', coach: 'She has already raised her hand. Give her one clear next step.' },
  { id: 6, name: 'Renji Okabe', initials: 'RO', city: 'Sapporo, Japan', segment: 'New Lead', ltv: 0, lastTrip: '—', lastDate: '—', status: 'Sent', open: 1, tier: 'Trail', priority: 'Soon', action: 'Send a warm introduction', },
  { id: 7, name: 'Freya Aaltonen', initials: 'FA', city: 'Helsinki, FI', segment: 'Returning Voyager', ltv: 15890, lastTrip: 'Kumano Kodō Pilgrimage', lastDate: 'May 2025', status: 'Opened', open: 5, tier: 'Summit', priority: 'Later', action: 'Invite her to the private preview', coach: 'Anchor on continuity: the next journey should feel like a chapter, not a restart.' },
  { id: 8, name: 'Søren Vestergaard', initials: 'SV', city: 'Bergen, Norway', segment: 'Dormant', ltv: 6020, lastTrip: 'Nikkō Autumn Leaves', lastDate: 'Nov 2023', status: 'Not sent', open: 0, tier: 'Trail', priority: 'Later', action: 'Hold for a better seasonal signal', },
  { id: 9, name: 'Yuki Morimoto', initials: 'YM', city: 'Osaka, Japan', segment: 'High Intent', ltv: 11760, lastTrip: 'Faroe Islands Trek', lastDate: 'Aug 2024', status: 'Booked', open: 7, tier: 'Ridge', priority: 'Soon', action: 'Follow up on the private guide option', },
];

const SEGMENTS = ['All contacts', 'Today', 'Returning Voyager', 'High Intent', 'Dormant'];
const STATUS_STYLE = {
  Booked: { dot: '#61765D', bg: '#E7EFE3', text: '#4F654C' },
  Opened: { dot: '#B9674E', bg: '#F4E7DF', text: '#96533F' },
  Sent: { dot: '#9A8F7B', bg: '#ECE9E1', text: '#746D61' },
  'Not sent': { dot: '#C8BFAF', bg: '#F2EFE9', text: '#918878' },
};
const spring = { type: 'spring', stiffness: 360, damping: 28, mass: 0.7 };
const softSpring = { type: 'spring', stiffness: 190, damping: 24 };

function StatusPill({ status }: { status: Contact['status'] }) {
  const style = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.04em]" style={{ background: style.bg, color: style.text }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} />
      {status}
    </span>
  );
}

function Initials({ contact, small = false }: { contact: Contact; small?: boolean }) {
  return (
    <div className={`${small ? 'h-8 w-8 text-[10px]' : 'h-11 w-11 text-[13px]'} flex shrink-0 items-center justify-center rounded-full border font-semibold`} style={{ background: contact.tier === 'Summit' ? '#253047' : contact.tier === 'Ridge' ? '#DCE3DF' : '#E9E4DA', color: contact.tier === 'Summit' ? '#E5B976' : '#253047', borderColor: 'rgba(37,48,71,0.12)' }}>
      {contact.initials}
    </div>
  );
}

export default function App() {
  const [segment, setSegment] = useState('All contacts');
  const [query, setQuery] = useState('');
  const [completed, setCompleted] = useState<number[]>([3]);
  const [modalContact, setModalContact] = useState<Contact | null>(null);
  const [focusCoach, setFocusCoach] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [activeNav, setActiveNav] = useState('Today');
  const coachRef = useRef<HTMLDetailsElement>(null);

  const filtered = useMemo(() => CONTACTS.filter((contact) => {
    const matchesSegment = segment === 'All contacts' || (segment === 'Today' ? contact.priority === 'Today' : contact.segment === segment);
    const haystack = `${contact.name} ${contact.city} ${contact.action}`.toLowerCase();
    return matchesSegment && haystack.includes(query.toLowerCase());
  }), [query, segment]);

  const todayContacts = CONTACTS.filter((contact) => contact.priority === 'Today');
  const completedToday = completed.filter((id) => todayContacts.some((contact) => contact.id === id)).length;

  useEffect(() => {
    if (modalContact && focusCoach) {
      requestAnimationFrame(() => coachRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [focusCoach, modalContact]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const openContact = (contact: Contact, coach = false) => {
    setModalContact(contact);
    setFocusCoach(coach);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: '#F1ECE3', color: '#253047', fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=Noto+Sans+JP:wght@400;500&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: `
        * { -webkit-font-smoothing: antialiased; }
        .display-serif { font-family: 'Instrument Serif', serif; }
        .jp { font-family: 'Noto Sans JP', sans-serif; }
        .hairline { border-color: rgba(37,48,71,0.12); }
        .grain { position: fixed; inset: 0; pointer-events: none; z-index: 40; opacity: .035; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .scrollbar-none::-webkit-scrollbar { display:none; }
        .scrollbar-none { scrollbar-width:none; }
        input::placeholder { color: #9B9589; }
      ` }} />
      <div className="grain" />

      <div className="flex min-h-screen">
        <aside className="hidden w-[236px] shrink-0 flex-col border-r px-6 py-7 lg:flex" style={{ background: '#E8E2D7', borderColor: 'rgba(37,48,71,0.12)' }}>
          <button onClick={() => setActiveNav('Today')} className="mb-12 flex items-center gap-3 text-left">
            <div className="flex h-9 w-9 items-center justify-center rounded-[11px]" style={{ background: '#253047' }}><Compass size={17} color="#E5B976" strokeWidth={1.7} /></div>
            <div>
              <div className="display-serif text-[19px] leading-none">Next Touch</div>
              <div className="jp mt-1 text-[9px] tracking-[0.28em]" style={{ color: '#918878' }}>次の一手 · THE NEXT MOVE</div>
            </div>
          </button>

          <div className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em]" style={{ color: '#9B9589' }}>Workspace</div>
          <nav className="flex flex-col gap-1">
            {[
              { label: 'Today', icon: Zap, count: 3 },
              { label: 'Contacts', icon: Users },
              { label: 'Calendar', icon: CalendarDays, count: 2 },
              { label: 'Campaigns', icon: Send },
            ].map((item) => (
              <motion.button key={item.label} onClick={() => setActiveNav(item.label)} whileHover={{ x: 4 }} whileTap={{ scale: 0.97 }} transition={spring} className="flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-[12.5px] font-semibold" style={{ background: activeNav === item.label ? '#F6F2EA' : 'transparent', color: activeNav === item.label ? '#253047' : '#817A6D', boxShadow: activeNav === item.label ? '0 1px 2px rgba(37,48,71,.05)' : 'none' }}>
                <span className="flex items-center gap-3"><item.icon size={15} strokeWidth={1.8} />{item.label}</span>
                {item.count && <span className="rounded-full px-1.5 py-0.5 text-[9px]" style={{ background: activeNav === item.label ? '#EED6BC' : '#DDD6C9', color: '#8C5D42' }}>{item.count}</span>}
              </motion.button>
            ))}
          </nav>

          <div className="mt-auto">
            <div className="rounded-2xl border p-4" style={{ background: '#F6F2EA', borderColor: 'rgba(37,48,71,0.10)' }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="jp text-[10px] tracking-[0.18em]" style={{ color: '#B9674E' }}>今日の焦点</span>
                <Sparkles size={13} style={{ color: '#D29A57' }} />
              </div>
              <div className="display-serif text-[18px] leading-tight">Make the warm call.</div>
              <div className="mt-1.5 text-[11px] leading-relaxed" style={{ color: '#817A6D' }}>Tomas opened twice. A clear answer today keeps the trip moving.</div>
              <button onClick={() => openContact(CONTACTS[1], true)} className="mt-3 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: '#B9674E' }}>Open coach <ArrowUpRight size={12} /></button>
            </div>
            <div className="mt-5 flex items-center gap-3 px-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: '#253047', color: '#E5B976' }}>HN</div>
              <div><div className="text-[11.5px] font-bold">Hana Nakamura</div><div className="text-[10px]" style={{ color: '#918878' }}>Sales lead · Kyoto desk</div></div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b px-5 py-4 backdrop-blur-xl sm:px-8 lg:px-10" style={{ background: 'rgba(241,236,227,.88)', borderColor: 'rgba(37,48,71,0.10)' }}>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: '#9B9589' }}><span>Workspace</span><span>/</span><span className="font-bold" style={{ color: '#253047' }}>{activeNav} · personal command center</span></div>
            <div className="flex items-center gap-2.5">
              <label className="hidden h-9 w-[220px] items-center gap-2 rounded-lg border px-3 md:flex" style={{ background: '#F6F2EA', borderColor: 'rgba(37,48,71,0.11)' }}>
                <Search size={14} style={{ color: '#9B9589' }} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people or next actions…" className="w-full bg-transparent text-[11.5px] outline-none" />
              </label>
              <div className="relative">
                <motion.button aria-label="Notifications" onClick={() => setNoticeOpen(!noticeOpen)} whileTap={{ scale: .92 }} className="relative flex h-9 w-9 items-center justify-center rounded-lg border" style={{ background: '#F6F2EA', borderColor: 'rgba(37,48,71,0.11)' }}><Bell size={15} strokeWidth={1.8} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{ background: '#B9674E' }} /></motion.button>
                {noticeOpen && <div className="absolute right-0 top-11 w-56 rounded-xl border p-3 text-[11px] shadow-xl" style={{ background: '#FBF8F1', borderColor: 'rgba(37,48,71,.13)' }}><div className="font-bold">One useful nudge</div><div className="mt-1 leading-relaxed" style={{ color: '#817A6D' }}>Tomas is waiting on an answer. His second open is a good signal to call now.</div></div>}
              </div>
              <motion.button onClick={() => openContact(CONTACTS[0])} whileHover={{ y: -2 }} whileTap={{ scale: .97 }} transition={spring} className="hidden items-center gap-2 rounded-lg px-3.5 py-2 text-[11.5px] font-bold sm:flex" style={{ background: '#253047', color: '#F1ECE3' }}>New touch <ArrowUpRight size={13} /></motion.button>
            </div>
          </header>

          <div className="mx-auto max-w-[1400px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
            <section className="relative mb-7 overflow-hidden rounded-[22px] p-7 sm:p-9 lg:p-11" style={{ background: '#253047', color: '#F1ECE3' }}>
              <div className="absolute -right-4 -top-12 jp text-[180px] leading-none opacity-[.055]">今日</div>
              <div className="relative flex flex-col justify-between gap-8 xl:flex-row xl:items-end">
                <div className="max-w-[620px]">
                  <div className="mb-4 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: '#E5B976' }}><span>Tuesday · September 19</span><span className="h-px w-9 bg-[#E5B976]/40" /><span style={{ color: 'rgba(241,236,227,.44)' }}>07:42 in Kyoto</span></div>
                  <h1 className="display-serif text-[42px] font-normal leading-[.98] tracking-[-.02em] sm:text-[56px]">A clear day<br /><em style={{ color: '#E5B976' }}>starts with one good move.</em></h1>
                  <p className="mt-5 max-w-[500px] text-[13px] leading-relaxed" style={{ color: 'rgba(241,236,227,.64)' }}>Your relationships are moving. Three people need your attention before lunch; one warm call can change the shape of the week.</p>
                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    <motion.button onClick={() => openContact(CONTACTS[1], true)} whileHover={{ y: -2 }} whileTap={{ scale: .97 }} transition={spring} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[12px] font-bold" style={{ background: '#E5B976', color: '#253047' }}>Start next touch <ArrowRight size={14} /></motion.button>
                    <button onClick={() => { setSegment('Today'); showToast('Showing your three most important touches.'); }} className="rounded-lg border px-4 py-2.5 text-[12px] font-semibold" style={{ borderColor: 'rgba(241,236,227,.24)', color: '#F1ECE3' }}>Review the day</button>
                  </div>
                </div>
                <div className="w-full max-w-[370px]">
                  <div className="mb-3 flex items-end justify-between"><div><div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'rgba(241,236,227,.45)' }}>Daily momentum</div><div className="display-serif mt-1 text-[31px]">{completedToday} <span className="text-[18px]" style={{ color: 'rgba(241,236,227,.44)' }}>/ {todayContacts.length} touches</span></div></div><div className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: 'rgba(229,185,118,.14)', color: '#E5B976' }}>+1 since 08:00</div></div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(241,236,227,.12)' }}><motion.div initial={{ width: 0 }} animate={{ width: `${Math.max((completedToday / todayContacts.length) * 100, 8)}%` }} transition={{ ...softSpring, delay: .4 }} className="h-full rounded-full" style={{ background: '#E5B976' }} /></div>
                  <div className="mt-3 flex justify-between text-[10px]" style={{ color: 'rgba(241,236,227,.42)' }}><span>Keep the thread warm</span><span>Next check-in 11:30</span></div>
                </div>
              </div>
            </section>

            <section className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { label: 'Touches completed', value: `${completed.length + 5}`, delta: '+2 this morning', icon: CheckCircle2, tone: '#61765D' },
                { label: 'Open conversations', value: '14', delta: '4 need a reply', icon: Mail, tone: '#B9674E' },
                { label: 'Meetings this week', value: '08', delta: '2 today', icon: CalendarDays, tone: '#8C6D9C' },
                { label: 'Pipeline momentum', value: '+18%', delta: 'vs. last week', icon: TrendingUp, tone: '#B77D43' },
              ].map((stat, index) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...softSpring, delay: .08 + index * .06 }} whileHover={{ y: -3 }} className="rounded-2xl border p-4 sm:p-5" style={{ background: '#F8F4EC', borderColor: 'rgba(37,48,71,.11)' }}>
                  <div className="mb-5 flex items-center justify-between"><span className="text-[9.5px] font-bold uppercase tracking-[0.16em]" style={{ color: '#9B9589' }}>{stat.label}</span><stat.icon size={15} style={{ color: stat.tone }} strokeWidth={1.8} /></div>
                  <div className="display-serif text-[29px] leading-none">{stat.value}</div><div className="mt-2 text-[10.5px] font-bold" style={{ color: stat.tone }}>{stat.delta}</div>
                </motion.div>
              ))}
            </section>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_350px]">
              <section>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                  <div><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#B9674E' }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: '#B9674E' }} /> Your attention queue</div><h2 className="display-serif text-[30px] leading-none">The next right moves</h2><p className="mt-2 text-[11.5px]" style={{ color: '#817A6D' }}>{filtered.length} relationships in view · sorted by what matters now</p></div>
                  <div className="flex items-center gap-2"><button onClick={() => setSegment(segment === 'Today' ? 'All contacts' : 'Today')} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold" style={{ background: '#F8F4EC', borderColor: 'rgba(37,48,71,.11)' }}><Filter size={13} /> {segment === 'Today' ? 'All contacts' : 'Focus today'}</button><button onClick={() => showToast('Queue is already sorted by relationship momentum.')} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold" style={{ background: '#F8F4EC', borderColor: 'rgba(37,48,71,.11)' }}><SlidersHorizontal size={13} /> Refine</button></div>
                </div>
                <div className="scrollbar-none mb-5 flex gap-1.5 overflow-x-auto pb-1">
                  {SEGMENTS.map((item) => <button key={item} onClick={() => setSegment(item)} className="shrink-0 rounded-full px-3.5 py-2 text-[10.5px] font-bold transition-colors" style={{ background: segment === item ? '#253047' : '#E8E2D7', color: segment === item ? '#F1ECE3' : '#817A6D' }}>{item}</button>)}
                </div>
                <motion.div layout className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <AnimatePresence mode="popLayout">
                    {filtered.map((contact) => (
                      <motion.article key={contact.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .97 }} transition={spring} whileHover={{ y: -4 }} className="group rounded-2xl border p-4.5 p-5" style={{ background: '#F8F4EC', borderColor: completed.includes(contact.id) ? 'rgba(97,118,93,.35)' : 'rgba(37,48,71,.11)', boxShadow: '0 2px 3px rgba(37,48,71,.025)' }}>
                        <div className="flex items-start justify-between gap-3"><button onClick={() => openContact(contact)} className="flex min-w-0 items-center gap-3 text-left"><Initials contact={contact} /><span className="min-w-0"><span className="block truncate text-[13px] font-bold" style={{ color: '#253047' }}>{contact.name}</span><span className="mt-0.5 flex items-center gap-1 text-[10.5px]" style={{ color: '#918878' }}><MapPin size={10} />{contact.city}</span></span></button><button aria-label={`More actions for ${contact.name}`} onClick={() => showToast(`More relationship actions for ${contact.name}`)} className="rounded-md p-1" style={{ color: '#A49B8D' }}><MoreHorizontal size={15} /></button></div>
                        <div className="mt-4 flex flex-wrap items-center gap-1.5"><StatusPill status={contact.status} /><span className="rounded-full border px-2.5 py-1 text-[10px] font-semibold" style={{ color: '#746D61', borderColor: 'rgba(37,48,71,.12)' }}>{contact.segment}</span>{contact.tier === 'Summit' && <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: '#F3E6C9', color: '#906C33' }}><Star size={9} fill="#906C33" strokeWidth={0} /> Summit</span>}</div>
                        <div className="mt-4 rounded-xl border px-3.5 py-3" style={{ background: completed.includes(contact.id) ? '#EDF3EA' : '#F1ECE3', borderColor: 'rgba(37,48,71,.07)' }}><div className="flex items-start gap-2.5"><button onClick={() => setCompleted((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])} aria-label={completed.includes(contact.id) ? `Reopen ${contact.name} task` : `Complete ${contact.name} task`} className="mt-0.5 shrink-0">{completed.includes(contact.id) ? <CheckCircle2 size={16} style={{ color: '#61765D' }} /> : <Circle size={16} style={{ color: '#B7AD9E' }} />}</button><div><div className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: '#9B9589' }}>{completed.includes(contact.id) ? 'Completed' : `${contact.priority} move`}</div><div className="mt-1 text-[11.5px] font-semibold leading-snug" style={{ color: completed.includes(contact.id) ? '#61765D' : '#4F4A42' }}>{contact.action}</div></div></div></div>
                        <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'rgba(37,48,71,.10)' }}><span className="text-[10.5px]" style={{ color: '#918878' }}>Lifetime value <strong className="ml-1 font-bold" style={{ color: '#4F4A42' }}>{contact.ltv ? `¥${(contact.ltv / 100).toFixed(1)}万` : 'New relationship'}</strong></span>{contact.coach && <button onClick={() => openContact(contact, true)} className="flex items-center gap-1 text-[10.5px] font-bold" style={{ color: '#B9674E' }}>Coach <ArrowUpRight size={11} /></button>}</div>
                      </motion.article>
                    ))}
                  </AnimatePresence>
                </motion.div>
                {filtered.length === 0 && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border p-12 text-center" style={{ background: '#F8F4EC', borderColor: 'rgba(37,48,71,.11)' }}><div className="display-serif text-[22px]">No relationship in this view</div><p className="mt-1 text-[11px]" style={{ color: '#918878' }}>Try another segment or clear your search.</p></motion.div>}
              </section>

              <aside className="space-y-5">
                <section className="rounded-2xl border p-5" style={{ background: '#E8E2D7', borderColor: 'rgba(37,48,71,.10)' }}>
                  <div className="mb-4 flex items-center justify-between"><div><div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.2em]" style={{ color: '#B9674E' }}>Stay oriented</div><h3 className="display-serif text-[25px]">This week</h3></div><button onClick={() => setActiveNav('Calendar')} className="rounded-md p-1.5" style={{ color: '#817A6D' }}><CalendarDays size={15} /></button></div>
                  <div className="space-y-1">
                    {[
                      { day: 'Tue 19', time: '09:30', title: 'Tomas Eriksen', detail: 'Family itinerary call', icon: Phone, color: '#B9674E' },
                      { day: 'Tue 19', time: '14:00', title: 'Aiko Tanabe', detail: 'Final room preference', icon: Mail, color: '#61765D' },
                      { day: 'Thu 21', time: '11:00', title: 'Clara Nørgaard', detail: 'Tōhoku alternative', icon: MountainSnow, color: '#8C6D9C' },
                    ].map((meeting, index) => <button key={meeting.title} onClick={() => openContact(CONTACTS[index === 0 ? 1 : index === 1 ? 2 : 4])} className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[#F6F2EA]"><div className="w-12 shrink-0"><div className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: '#9B9589' }}>{meeting.day}</div><div className="mt-0.5 text-[10px] font-bold" style={{ color: '#4F4A42' }}>{meeting.time}</div></div><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meeting.color}16`, color: meeting.color }}><meeting.icon size={14} /></div><div className="min-w-0"><div className="truncate text-[11px] font-bold">{meeting.title}</div><div className="truncate text-[10px]" style={{ color: '#918878' }}>{meeting.detail}</div></div><ArrowUpRight size={12} className="ml-auto shrink-0" style={{ color: '#B8AF9F' }} /></button>)}
                  </div>
                  <button onClick={() => setActiveNav('Calendar')} className="mt-3 flex items-center gap-1.5 px-2.5 text-[10.5px] font-bold" style={{ color: '#B9674E' }}>Open calendar <ArrowRight size={12} /></button>
                </section>

                <section className="rounded-2xl border p-5" style={{ background: '#253047', color: '#F1ECE3', borderColor: '#253047' }}>
                  <div className="flex items-start justify-between"><div><div className="mb-1 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.2em]" style={{ color: '#E5B976' }}><Sparkles size={12} /> Signal, not noise</div><h3 className="display-serif text-[24px]">A little context<br /><em style={{ color: '#E5B976' }}>for your next move.</em></h3></div><Zap size={17} style={{ color: '#E5B976' }} /></div>
                  <p className="mt-4 text-[11.5px] leading-relaxed" style={{ color: 'rgba(241,236,227,.58)' }}>Four people opened something this morning. Tomas opened twice; Clara opened from the campaign email. Start with the person closest to a decision.</p>
                  <div className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(241,236,227,.14)' }}><div className="flex items-center justify-between text-[10px]"><span style={{ color: 'rgba(241,236,227,.45)' }}>Relationship momentum</span><span className="font-bold" style={{ color: '#E5B976' }}>18% ↑</span></div><div className="mt-2 h-1.5 rounded-full" style={{ background: 'rgba(241,236,227,.12)' }}><div className="h-full w-[68%] rounded-full" style={{ background: '#E5B976' }} /></div></div>
                </section>

                <div className="flex items-center gap-2 px-1 text-[10px]" style={{ color: '#9B9589' }}><Clock3 size={12} /> Last synced 8 minutes ago <span className="h-1 w-1 rounded-full" style={{ background: '#61765D' }} /> All systems calm</div>
              </aside>
            </div>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {modalContact && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModalContact(null)} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-10 sm:p-8 sm:pt-16" style={{ background: 'rgba(25,31,45,.62)' }}>
          <motion.div initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} onClick={(event) => event.stopPropagation()} className="relative w-full max-w-[620px] rounded-[22px] border p-6 shadow-2xl sm:p-8" style={{ background: '#F8F4EC', borderColor: 'rgba(37,48,71,.13)' }}>
            <button aria-label="Close contact brief" onClick={() => setModalContact(null)} className="absolute right-5 top-5 rounded-lg p-1.5" style={{ color: '#918878' }}><X size={18} /></button>
            <div className="flex items-start gap-4 pr-8"><Initials contact={modalContact} /><div><div className="mb-2 flex items-center gap-2"><StatusPill status={modalContact.status} />{modalContact.tier === 'Summit' && <span className="text-[10px] font-bold" style={{ color: '#906C33' }}>Summit tier</span>}</div><h2 className="display-serif text-[32px] leading-none">{modalContact.name}</h2><div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: '#918878' }}><MapPin size={11} />{modalContact.city} · {modalContact.segment}</div></div></div>
            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Last journey', modalContact.lastTrip], ['Lifetime value', modalContact.ltv ? `¥${(modalContact.ltv / 100).toFixed(1)}万` : 'New'], ['Email opens', `${modalContact.open}`]].map(([label, value]) => <div key={label} className="rounded-xl border p-3" style={{ background: '#F1ECE3', borderColor: 'rgba(37,48,71,.08)' }}><div className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: '#9B9589' }}>{label}</div><div className="mt-1 text-[11.5px] font-bold leading-snug">{value}</div></div>)}</div>
            <div className="mt-5 space-y-2"><details open className="border-t pt-3" style={{ borderColor: 'rgba(37,48,71,.10)' }}><summary className="cursor-pointer text-[12px] font-bold">Conversation history & notes</summary><p className="mt-2 text-[12px] leading-relaxed" style={{ color: '#746D61' }}>Last journey: {modalContact.lastTrip}. The relationship has enough warmth for a specific, personal follow-up today.</p></details><details open className="border-t pt-3" style={{ borderColor: 'rgba(37,48,71,.10)' }}><summary className="cursor-pointer text-[12px] font-bold">Recommended next action</summary><p className="mt-2 text-[12px] leading-relaxed" style={{ color: '#746D61' }}>{modalContact.action}.</p></details><details ref={coachRef} open={focusCoach} className="border-t pt-3" style={{ borderColor: 'rgba(37,48,71,.10)' }}><summary className="cursor-pointer text-[12px] font-bold" style={{ color: '#B9674E' }}>Call Coach</summary><div className="mt-2 rounded-xl p-3.5 text-[12px] leading-relaxed" style={{ background: '#F3E6DE', color: '#7E493B' }}>{modalContact.coach || 'No coach note yet. Keep this touch light, specific, and easy to answer.'}</div></details></div>
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: 'rgba(37,48,71,.10)' }}><button onClick={() => { setCompleted((current) => current.includes(modalContact.id) ? current : [...current, modalContact.id]); showToast('Touchpoint marked complete. Nice move.'); setModalContact(null); }} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-bold" style={{ background: '#253047', color: '#F1ECE3' }}><CheckCircle2 size={14} /> Mark touch complete</button><button onClick={() => showToast('Verbiage guide ready in a new tab.')} className="rounded-lg border px-4 py-2.5 text-[11px] font-bold" style={{ borderColor: 'rgba(37,48,71,.14)', color: '#746D61' }}>Open verbiage guide</button></div>
          </motion.div>
        </motion.div>}
      </AnimatePresence>
      {toast && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2.5 text-[11px] font-bold shadow-xl" style={{ background: '#253047', color: '#F1ECE3' }}>{toast}</motion.div>}
    </div>
  );
}