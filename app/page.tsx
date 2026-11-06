'use client';

import { useEffect, useState } from 'react';

type TelegramApp = { initData: string; ready(): void; expand(): void; openLink(url: string): void };
declare global { interface Window { Telegram?: { WebApp: TelegramApp } } }

type Field = { id: string; title: string; description: string; price_kzt: number; opens_at: string; closes_at: string; active?: boolean };
type Slot = { time: string; available: boolean };
type Booking = { id: string; field_id: string; field_title: string; price_kzt: number; status: string; date: string; time: string; hold_expires_at: string };
type AdminBooking = Booking & { telegram_id: string; first_name: string; username: string | null };
type Profile = { user: { id: number; first_name: string }; is_admin: boolean; payment_url: string | null };
type FieldForm = { id: string; title: string; description: string; price_kzt: string; opens_at: string; closes_at: string; active: boolean };
type Tab = 'book' | 'mine' | 'admin';

const blankField: FieldForm = { id: '', title: '', description: '', price_kzt: '', opens_at: '07:00', closes_at: '23:00', active: true };
const money = (sum: number): string => new Intl.NumberFormat('ru-RU').format(sum) + ' ₸';
const today = (): string => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const limitDay = (): string => new Date(Date.now() + (30 * 24 + 5) * 3600000).toISOString().slice(0, 10);
const labels: Record<string, string> = {
  held: 'Ожидает оплаты', review: 'Проверка оплаты', confirmed: 'Подтверждено',
  rejected: 'Отклонено', expired: 'Время оплаты истекло',
};

export default function Home() {
  const [auth, setAuth] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldId, setFieldId] = useState('');
  const [day, setDay] = useState(today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [hour, setHour] = useState('');
  const [tab, setTab] = useState<Tab>('book');
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [adminBookings, setAdminBookings] = useState<AdminBooking[]>([]);
  const [adminFields, setAdminFields] = useState<Field[]>([]);
  const [form, setForm] = useState<FieldForm>(blankField);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const result = await fetch(path, {
      ...options,
      headers: { 'x-telegram-init-data': auth, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    });
    const payload = await result.json() as T & { error?: string };
    if (!result.ok) throw new Error(payload.error || 'Ошибка запроса');
    return payload;
  }

  useEffect(() => {
    const app = window.Telegram?.WebApp;
    if (!app?.initData) { setError('Откройте Mini App через кнопку меню Telegram-бота.'); return; }
    app.ready();
    app.expand();
    setAuth(app.initData);
  }, []);

  useEffect(() => {
    if (!auth) return;
    let alive = true;
    Promise.all([api<Profile>('/api/me'), api<{ fields: Field[] }>('/api/fields')])
      .then(([me, data]) => {
        if (!alive) return;
        setProfile(me);
        setFields(data.fields);
        setFieldId(String(data.fields[0]?.id || ''));
      })
      .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'); });
    return () => { alive = false; };
  }, [auth]);

  useEffect(() => {
    if (!auth || !fieldId) { setSlots([]); return; }
    let alive = true;
    setHour('');
    api<{ slots: Slot[] }>('/api/availability?fieldId=' + encodeURIComponent(fieldId) + '&date=' + encodeURIComponent(day))
      .then((data) => { if (alive) setSlots(data.slots); })
      .catch((reason: unknown) => { if (alive) setMessage(reason instanceof Error ? reason.message : 'Ошибка расписания'); });
    return () => { alive = false; };
  }, [auth, fieldId, day, refresh]);

  async function loadMine(): Promise<void> {
    const data = await api<{ bookings: Booking[] }>('/api/bookings');
    setMyBookings(data.bookings);
  }
  async function loadAdmin(): Promise<void> {
    const [bookings, allFields] = await Promise.all([
      api<{ bookings: AdminBooking[] }>('/api/admin/bookings'),
      api<{ fields: Field[] }>('/api/admin/fields'),
    ]);
    setAdminBookings(bookings.bookings);
    setAdminFields(allFields.fields);
  }
  async function switchTab(next: Tab): Promise<void> {
    setTab(next);
    setMessage('');
    if (next === 'book') setRefresh((x) => x + 1);
    try {
      if (next === 'mine') await loadMine();
      if (next === 'admin' && profile?.is_admin) await loadAdmin();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Ошибка обновления');
    }
  }

  async function createBooking(): Promise<void> {
    if (!hour || !fieldId || busy) return;
    setBusy(true);
    try {
      await api('/api/bookings', { method: 'POST', body: JSON.stringify({ field_id: Number(fieldId), date: day, time: hour }) });
      await switchTab('mine');
      setMessage('Час зарезервирован на 20 минут. Оплатите и отметьте оплату.');
      setRefresh((x) => x + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Ошибка бронирования');
      setRefresh((x) => x + 1);
    } finally { setBusy(false); }
  }

  async function markPaid(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await api('/api/bookings/' + encodeURIComponent(id) + '/paid', { method: 'POST' });
      await loadMine();
      setMessage('Передано администратору. Бронь будет подтверждена только после проверки денег в Kaspi Pay.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Ошибка'); }
    finally { setBusy(false); }
  }

  function openPayment(): void {
    const url = profile?.payment_url;
    if (!url) { setMessage('Платёжная ссылка пока не настроена.'); return; }
    if (window.Telegram?.WebApp) window.Telegram.WebApp.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function review(id: string, decision: 'confirm' | 'reject'): Promise<void> {
    if (busy) return;
    if (decision === 'confirm' && !window.confirm('Вы лично сверили поступление денег в Kaspi Pay?')) return;
    setBusy(true);
    try {
      await api('/api/admin/bookings/' + encodeURIComponent(id) + '/decision', {
        method: 'POST', body: JSON.stringify({ decision }),
      });
      await loadAdmin();
      setMessage(decision === 'confirm' ? 'Оплата подтверждена.' : 'Бронь отклонена.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Ошибка'); }
    finally { setBusy(false); }
  }

  function editField(field: Field): void {
    setForm({ id: String(field.id), title: field.title, description: field.description,
      price_kzt: String(field.price_kzt), opens_at: field.opens_at,
      closes_at: field.closes_at, active: field.active !== false });
  }

  async function saveField(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await api('/api/admin/fields', {
        method: form.id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          id: form.id ? Number(form.id) : undefined,
          title: form.title, description: form.description, price_kzt: Number(form.price_kzt),
          opens_at: form.opens_at, closes_at: form.closes_at, active: form.active,
        }),
      });
      setForm(blankField);
      await loadAdmin();
      const data = await api<{ fields: Field[] }>('/api/fields');
      setFields(data.fields);
      setFieldId((old) => data.fields.some((item) => String(item.id) === old)
        ? old : String(data.fields[0]?.id || ''));
      setRefresh((x) => x + 1);
      setMessage('Поле сохранено.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Ошибка'); }
    finally { setBusy(false); }
  }

  const currentField = fields.find((field) => String(field.id) === fieldId);
  return (
    <main className="shell">
      <header className="brand"><div className="logo">K</div><div><strong>KANAS</strong><small>Футбольные поля</small></div></header>
      <section className="hero"><div className="eyebrow">АРЕНДА ФУТБОЛЬНЫХ ПОЛЕЙ</div>
        <h1>Твоё поле.<br/><em>Твоё время.</em></h1><p>Выбирайте свободный час и бронируйте в Telegram.</p>
        {profile && <span className="greeting">Привет, {profile.user.first_name}!</span>}
      </section>
      {error && <p className="alert error" role="alert">{error}</p>}
      {message && <p className="alert" role="status">{message}</p>}
      {!profile && !error && <p className="loading">Загрузка...</p>}
      {profile && <>
        <nav className="tabs">
          <button className={tab === 'book' ? 'active' : ''} onClick={() => void switchTab('book')}>Бронирование</button>
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => void switchTab('mine')}>Мои брони</button>
          {profile.is_admin && <button className={tab === 'admin' ? 'active' : ''} onClick={() => void switchTab('admin')}>Админ</button>}
        </nav>
        {tab === 'book' && <section>
          <h2>Выберите поле</h2>
          {!fields.length && <div className="empty">Администратор ещё не добавил поля.</div>}
          <div className="stack">{fields.map((field) =>
            <button key={field.id} className={'field ' + (fieldId === String(field.id) ? 'chosen' : '')}
              onClick={() => setFieldId(String(field.id))}>
              <div className="field-symbol">⚽</div>
              <div className="field-info"><strong>{field.title}</strong>
                {field.description && <small>{field.description}</small>}
                <small>{field.opens_at} — {field.closes_at}</small></div>
              <div className="price"><strong>{money(field.price_kzt)}</strong><small>за час</small></div>
            </button>)}</div>
          {currentField && <>
            <h2 className="spaced">Дата игры</h2>
            <input className="date" type="date" min={today()} max={limitDay()} value={day} onChange={(e) => setDay(e.target.value)} />
            <h2 className="spaced">Свободное время</h2>
            <div className="slots">{slots.map((slot) =>
              <button key={slot.time} disabled={!slot.available} className={hour === slot.time ? 'chosen' : ''}
                onClick={() => setHour(slot.time)}>{slot.time}</button>)}</div>
            {!slots.length && <p className="empty">На эту дату нет доступных часов.</p>}
            <div className="checkout"><div><small>Аренда на 1 час</small><strong>{money(currentField.price_kzt)}</strong></div>
              <button className="primary" disabled={!hour || busy} onClick={() => void createBooking()}>
                {busy ? 'Подождите...' : hour ? 'Забронировать на ' + hour : 'Выберите время'}
              </button><p>Бронь удерживается 20 минут до отметки оплаты.</p></div>
          </>}
        </section>}
        {tab === 'mine' && <section><h2>Мои бронирования</h2>
          {!myBookings.length && <p className="empty">Бронирований пока нет.</p>}
          <div className="stack">{myBookings.map((b) =>
            <article className="booking" key={b.id}>
              <div className="between"><strong>{b.field_title}</strong><span className={'status ' + b.status}>{labels[b.status] || b.status}</span></div>
              <p>{b.date} · {b.time} · {money(b.price_kzt)}</p><small>Бронь #{b.id.slice(0, 8)}</small>
              {b.status === 'held' && <div className="actions">
                <p>Оплатить до {new Date(b.hold_expires_at).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' })} (Астана)</p>
                <button disabled={!profile.payment_url} className="primary" onClick={openPayment}>
                  {profile.payment_url ? 'Оплатить через Kaspi' : 'Ссылка оплаты не настроена'}</button>
                <button className="secondary" disabled={busy || !profile.payment_url} onClick={() => void markPaid(b.id)}>Я оплатил</button>
                <p className="fineprint">Проверьте сумму перед оплатой. Отметка об оплате не подтверждает бронь автоматически.</p>
              </div>}
              {b.status === 'review' && <p className="fineprint">Администратор проверяет платёж.</p>}
            </article>)}</div>
        </section>}
        {tab === 'admin' && profile.is_admin && <section>
          <h2>Проверка оплат</h2>
          {!adminBookings.length && <p className="empty">Активных бронирований нет.</p>}
          <div className="stack">{adminBookings.map((b) =>
            <article key={b.id} className="booking"><div className="between"><strong>{b.field_title}</strong>
                <span className={'status ' + b.status}>{labels[b.status]}</span></div>
              <p>{b.date} · {b.time} · {money(b.price_kzt)}</p>
              <p>Клиент: {b.first_name} {b.username ? '@' + b.username : ''}</p>
              <small>Telegram: {b.telegram_id} · #{b.id.slice(0, 8)}</small>
              {b.status === 'review' && <div className="actions">
                <button disabled={busy} className="primary" onClick={() => void review(b.id, 'confirm')}>Подтвердить оплату</button>
                <button disabled={busy} className="danger" onClick={() => void review(b.id, 'reject')}>Отклонить</button>
              </div>}
            </article>)}</div>
          <h2 className="spaced">Управление полями</h2>
          <div className="stack">{adminFields.map((field) =>
            <button key={field.id} className="field-list" onClick={() => editField(field)}>
              <strong>{field.title}</strong><small>{money(field.price_kzt)} · {field.active ? 'Доступно' : 'Скрыто'} · Изменить</small>
            </button>)}</div>
          <form className="editor" onSubmit={(event) => { event.preventDefault(); void saveField(); }}>
            <h3>{form.id ? 'Редактировать поле' : 'Добавить поле'}</h3>
            <label>Название<input required minLength={2} maxLength={80} value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Поле №1" /></label>
            <label>Описание<textarea maxLength={500} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label>Стоимость за час, ₸<input type="number" required min={1} max={10000000} value={form.price_kzt}
              onChange={(e) => setForm({ ...form, price_kzt: e.target.value })} /></label>
            <div className="two-cols">
              <label>Открытие<input type="time" value={form.opens_at} required onChange={(e) => setForm({ ...form, opens_at: e.target.value })} /></label>
              <label>Закрытие<input type="time" value={form.closes_at} required onChange={(e) => setForm({ ...form, closes_at: e.target.value })} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Показывать поле клиентам</label>
            <button disabled={busy} className="primary" type="submit">Сохранить</button>
            {form.id && <button className="secondary" type="button" onClick={() => setForm(blankField)}>Добавить другое</button>}
          </form>
        </section>}
      </>}
      <footer>Kanas · Бронирование через Telegram</footer>
    </main>
  );
}
