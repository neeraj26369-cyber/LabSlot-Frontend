import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import api, { resetCsrfToken } from "./api";
import "./styles.css";

function Status({ value }) {
  return <span className={`status status-${String(value).toLowerCase()}`}>{value}</span>;
}

function DateTime({ booking }) {
  const date = new Date(`${booking.bookingDate}T00:00:00`);
  return <>{date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}<small>{String(booking.startTime).slice(0, 5)}–{String(booking.endTime).slice(0, 5)}</small></>;
}

function App() {
  const queryPortal = new URLSearchParams(window.location.search).get("portal");
  const pathPortal = window.location.pathname.startsWith("/admin") ? "admin" : window.location.pathname.startsWith("/student") ? "student" : null;
  const portal = queryPortal || pathPortal;
  console.log("LabSlot portal diagnostic:", {
  pathname: window.location.pathname,
  queryPortal,
  pathPortal,
  portal
});
  const portalRole = portal === "admin" ? "ADMIN" : portal === "student" ? "STUDENT" : null;
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [adminSignupAvailable, setAdminSignupAvailable] = useState(false);
  const [view, setView] = useState("overview");
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [equipment, setEquipment] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [editingEquipment, setEditingEquipment] = useState(null);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [bookingForm, setBookingForm] = useState({ bookingDate: "", startTime: "", endTime: "", purpose: "" });
  const [equipmentForm, setEquipmentForm] = useState({ name: "", description: "", category: "", quantity: 1, location: "", availabilityStatus: "AVAILABLE" });
  const [availability, setAvailability] = useState(null);

  useEffect(() => {
    async function initialize() {
      try {
        const response = await api.get("/auth/me");
        setUser(response.data);
      } catch {
        setUser(null);
        if (portalRole === "ADMIN") {
          try {
            const status = await api.get("/auth/setup-status");
            setAdminSignupAvailable(status.data.available);
          } catch { setMessage({ text: "Could not check administrator setup status.", kind: "error" }); }
        }
      } finally { setAuthReady(true); }
    }
    initialize();
  }, []);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, view, statusFilter]);

  async function loadData() {
    setBusy(true);
    try {
      const equipmentRequest = api.get("/equipment", { params: { search: search || undefined } });
      if (user.role === "ADMIN") {
        const [equipmentResponse, bookingResponse, summaryResponse] = await Promise.all([
          equipmentRequest,
          api.get("/bookings", { params: statusFilter === "ALL" ? {} : { status: statusFilter } }),
          api.get("/admin/summary")
        ]);
        setEquipment(equipmentResponse.data);
        setBookings(bookingResponse.data);
        setSummary(summaryResponse.data);
      } else {
        const [equipmentResponse, bookingResponse] = await Promise.all([equipmentRequest, api.get("/bookings/my")]);
        setEquipment(equipmentResponse.data);
        setBookings(bookingResponse.data);
      }
      setMessage(null);
    } catch (error) {
      if (error.response?.status === 401) setUser(null);
      setMessage({ text: error.userMessage, kind: "error" });
    } finally { setBusy(false); }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (authMode === "register") {
        await api.post("/auth/register", authForm);
        setAuthMode("login");
        setAuthForm({ name: "", email: authForm.email, password: "" });
        setMessage({ text: "Student account created. Sign in to open your desk.", kind: "success" });
      } else if (authMode === "setup-admin") {
        const response = await api.post("/auth/setup-admin", authForm);
        setUser(response.data);
        setAuthMode("login");
        setMessage({ text: "Administrator account created. You are signed in.", kind: "success" });
      } else {
        const response = await api.post("/auth/login", { email: authForm.email, password: authForm.password });
        setUser(response.data);
        setMessage(null);
      }
    } catch (error) { setMessage({ text: error.userMessage, kind: "error" }); }
    finally { setBusy(false); }
  }

  async function signOut() {
    try { await api.post("/auth/logout"); } finally { resetCsrfToken(); setUser(null); setView("overview"); setBookings([]); setEquipment([]); }
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (bookingForm.startTime >= bookingForm.endTime) {
      setMessage({ text: "Start time must be earlier than end time.", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const response = await api.post("/bookings", { ...bookingForm, equipmentId: selectedEquipment.id });
      setMessage({ text: `Request #${response.data.id} was sent for review.`, kind: "success" });
      setSelectedEquipment(null);
      setBookingForm({ bookingDate: "", startTime: "", endTime: "", purpose: "" });
      setAvailability(null);
      await loadData();
    } catch (error) { setMessage({ text: error.userMessage, kind: "error" }); }
    finally { setBusy(false); }
  }

  async function checkAvailability() {
    if (!bookingForm.bookingDate || !bookingForm.startTime || !bookingForm.endTime || bookingForm.startTime >= bookingForm.endTime) {
      setMessage({ text: "Choose a date and a valid start and end time first.", kind: "error" });
      return;
    }
    try {
      const params = { bookingDate: bookingForm.bookingDate, startTime: bookingForm.startTime, endTime: bookingForm.endTime };
      const response = await api.get(`/equipment/${selectedEquipment.id}/availability`, { params });
      setAvailability(response.data.available);
    } catch (error) { setMessage({ text: error.userMessage, kind: "error" }); }
  }

  async function cancelBooking(id) {
    if (!window.confirm("Cancel this reservation?")) return;
    try { await api.put(`/bookings/${id}/cancel`); setMessage({ text: "Booking cancelled.", kind: "success" }); await loadData(); }
    catch (error) { setMessage({ text: error.userMessage, kind: "error" }); }
  }

  async function decideBooking(id, action) {
    try { await api.put(`/bookings/${id}/${action}`); setMessage({ text: action === "approve" ? "Booking approved." : "Booking rejected.", kind: "success" }); await loadData(); }
    catch (error) { setMessage({ text: error.userMessage, kind: "error" }); }
  }

  function openEquipmentEditor(item = null) {
    setEditingEquipment(item || { id: null });
    setEquipmentForm(item ? { name: item.name, description: item.description, category: item.category, quantity: item.quantity, location: item.location, availabilityStatus: item.availabilityStatus } : { name: "", description: "", category: "", quantity: 1, location: "", availabilityStatus: "AVAILABLE" });
  }

  async function saveEquipment(event) {
    event.preventDefault();
    const body = { ...equipmentForm, quantity: Number(equipmentForm.quantity) };
    try {
      if (editingEquipment?.id) await api.put(`/equipment/${editingEquipment.id}`, body);
      else await api.post("/equipment", body);
      setEditingEquipment(null);
      setMessage({ text: "Equipment saved.", kind: "success" });
      await loadData();
    } catch (error) { setMessage({ text: error.userMessage, kind: "error" }); }
  }

  async function deleteEquipment(item) {
    if (!window.confirm(`Delete ${item.name}? Equipment with booking history is retained.`)) return;
    try { await api.delete(`/equipment/${item.id}`); setMessage({ text: "Equipment deleted.", kind: "success" }); await loadData(); }
    catch (error) { setMessage({ text: error.userMessage, kind: "error" }); }
  }

  const visibleBookings = user?.role === "STUDENT" && statusFilter !== "ALL" ? bookings.filter(row => row.status === statusFilter) : bookings;
  const bookingCounts = user?.role === "ADMIN" ? {
    PENDING: summary.pendingBookings ?? 0,
    APPROVED: summary.approvedBookings ?? 0,
    REJECTED: summary.rejectedBookings ?? 0,
    CANCELLED: summary.cancelledBookings ?? 0
  } : bookings.reduce((counts, booking) => ({ ...counts, [booking.status]: (counts[booking.status] || 0) + 1 }), {});
  const localToday = new Date();
  localToday.setMinutes(localToday.getMinutes() - localToday.getTimezoneOffset());
  const today = localToday.toISOString().slice(0, 10);

  if (!authReady) return <div className="boot-state">Opening the laboratory desk…</div>;
  if (!user && !portalRole) return <PortalPicker />;
  if (!user) return <AuthScreen role={portalRole} adminSignupAvailable={adminSignupAvailable} mode={authMode} setMode={setAuthMode} form={authForm} setForm={setAuthForm} submit={submitAuth} busy={busy} message={message} />;
  if (portalRole && user.role !== portalRole) return <PortalMismatch role={portalRole} signedInAs={user.role} signOut={signOut} />;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#overview" onClick={() => setView("overview")}>Lab<span>Slot</span><small>RESOURCE DESK</small></a>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>Overview</button>
        <button className={view === "equipment" ? "active" : ""} onClick={() => setView("equipment")}>Equipment</button>
        <button className={view === "bookings" ? "active" : ""} onClick={() => setView("bookings")}>Bookings</button>
      </nav>
      <div className="account-block"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="account-name">{user.name}<small>{user.role}</small></span><button className="signout" onClick={signOut}>Sign out</button></div>
    </header>

    <main className="workspace">
      <div className="page-title"><div><p className="kicker">{user.role === "ADMIN" ? "ADMINISTRATOR DESK" : "STUDENT DESK"}</p><h1>{view === "equipment" ? "Equipment register." : view === "bookings" ? "Booking history." : user.role === "ADMIN" ? "Laboratory overview." : `Good day, ${user.name.split(" ")[0]}.`}</h1><p>{view === "bookings" ? "Requests, approvals, and previous reservations." : view === "equipment" ? "Browse the instruments and supplies in your lab." : "Availability and reservations, together in one place."}</p></div>
        {user.role === "ADMIN" && view === "equipment" && <button className="button primary" onClick={() => openEquipmentEditor()}>＋ Add equipment</button>}
        {user.role === "STUDENT" && <button className="button primary" onClick={() => setView("equipment")}>Browse equipment <span>↗</span></button>}
      </div>
      {message && <div className={`notice ${message.kind}`} role="status">{message.text}<button onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div>}
      {busy && <div className="loading-line"><i></i> Updating records…</div>}

      {view === "overview" && user.role === "ADMIN" && <AdminOverview summary={summary} bookings={bookings.filter(row => row.status === "PENDING")} openBookings={() => { setStatusFilter("PENDING"); setView("bookings"); }} openApproved={() => { setStatusFilter("APPROVED"); setView("bookings"); }} decide={decideBooking} />}
      {view === "overview" && user.role === "STUDENT" && <StudentOverview equipment={equipment} bookings={bookings} choose={item => setSelectedEquipment(item)} setView={setView} />}
      {view === "equipment" && <EquipmentView items={equipment} search={search} setSearch={setSearch} reload={loadData} admin={user.role === "ADMIN"} choose={setSelectedEquipment} edit={openEquipmentEditor} remove={deleteEquipment} />}
      {view === "bookings" && <BookingTable rows={visibleBookings} admin={user.role === "ADMIN"} counts={bookingCounts} filter={statusFilter} setFilter={setStatusFilter} cancel={cancelBooking} decide={decideBooking} />}
    </main>

    {selectedEquipment && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedEquipment(null); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="close" onClick={() => setSelectedEquipment(null)} aria-label="Close">×</button><p className="kicker">NEW REQUEST</p><h2 id="booking-title">Reserve {selectedEquipment.name}</h2><p className="dialog-description">{selectedEquipment.description} · {selectedEquipment.location}</p><form onSubmit={submitBooking} className="form-grid"><label>Date<input type="date" min={today} value={bookingForm.bookingDate} onChange={event => setBookingForm({ ...bookingForm, bookingDate: event.target.value })} required /></label><label>Start<input type="time" value={bookingForm.startTime} onChange={event => setBookingForm({ ...bookingForm, startTime: event.target.value })} required /></label><label>End<input type="time" value={bookingForm.endTime} onChange={event => setBookingForm({ ...bookingForm, endTime: event.target.value })} required /></label><label className="wide">Purpose<textarea maxLength="500" rows="3" value={bookingForm.purpose} onChange={event => setBookingForm({ ...bookingForm, purpose: event.target.value })} required /></label><div className="wide dialog-actions"><button className="button outline" type="button" onClick={checkAvailability}>Check availability</button>{availability !== null && <span className={availability > 0 ? "available-text" : "error-text"}>{availability} unit{availability === 1 ? "" : "s"} available</span>}<button className="button primary" type="submit" disabled={busy}>Send request</button></div></form></section></div>}

    {editingEquipment !== null && <div className="modal-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="equipment-title"><button className="close" onClick={() => setEditingEquipment(null)} aria-label="Close">×</button><p className="kicker">RESOURCE MANAGEMENT</p><h2 id="equipment-title">{editingEquipment?.id ? "Edit equipment" : "Add equipment"}</h2><form onSubmit={saveEquipment} className="form-grid"><label>Name<input maxLength="120" value={equipmentForm.name} onChange={event => setEquipmentForm({ ...equipmentForm, name: event.target.value })} required /></label><label>Category<input maxLength="80" value={equipmentForm.category} onChange={event => setEquipmentForm({ ...equipmentForm, category: event.target.value })} required /></label><label className="wide">Description<textarea maxLength="2000" rows="2" value={equipmentForm.description} onChange={event => setEquipmentForm({ ...equipmentForm, description: event.target.value })} required /></label><label>Quantity<input type="number" min="1" max="10000" value={equipmentForm.quantity} onChange={event => setEquipmentForm({ ...equipmentForm, quantity: event.target.value })} required /></label><label>Location<input maxLength="120" value={equipmentForm.location} onChange={event => setEquipmentForm({ ...equipmentForm, location: event.target.value })} required /></label><label className="wide">Availability<select value={equipmentForm.availabilityStatus} onChange={event => setEquipmentForm({ ...equipmentForm, availabilityStatus: event.target.value })}><option>AVAILABLE</option><option>UNAVAILABLE</option><option>MAINTENANCE</option></select></label><div className="wide dialog-actions"><button className="button outline" type="button" onClick={() => setEditingEquipment(null)}>Cancel</button><button className="button primary" type="submit">Save equipment</button></div></form></section></div>}
  </div>;
}

function PortalPicker() {
  return <main className="portal-picker"><a className="brand" href="/">Lab<span>Slot</span><small>RESOURCE DESK</small></a><div className="portal-intro"><p className="kicker">LABORATORY / BOOKING DESK</p><h1>Choose your<br /><em>workbench.</em></h1><p>Sign in through the portal assigned to your role.</p></div><div className="portal-options"><a className="portal-option" href="/student"><span className="portal-number">01</span><span><strong>Student portal</strong><small>Browse equipment and track your reservations</small></span><b aria-hidden="true">↗</b></a><a className="portal-option admin-option" href="/admin"><span className="portal-number">02</span><span><strong>Administrator portal</strong><small>Manage equipment and review booking requests</small></span><b aria-hidden="true">↗</b></a></div><footer className="portal-footer">LabSlot <span>Laboratory resource coordination</span></footer></main>;
}

function PortalMismatch({ role, signedInAs, signOut }) {
  return <main className="auth-layout"><section className="auth-story"><a className="brand" href="/">Lab<span>Slot</span><small>RESOURCE DESK</small></a><div><p className="kicker">PORTAL ACCESS</p><h1>This is the<br /><em>{role === "ADMIN" ? "admin portal." : "student portal."}</em></h1><p>You are signed in with a {signedInAs.toLowerCase()} account. Sign out to choose the matching portal.</p></div></section><section className="auth-panel"><p className="kicker">ACCOUNT ROLE</p><h2>{signedInAs}</h2><p className="muted">Your account role controls which tools and records are available.</p><button className="button primary full" onClick={signOut}>Sign out and switch portal</button><a className="portal-back-link" href="/">← Choose a different portal</a></section></main>;
}

function AuthScreen({ role, adminSignupAvailable, mode, setMode, form, setForm, submit, busy, message }) {
  const register = mode === "register";
  const setupAdmin = role === "ADMIN" && mode === "setup-admin";
  return <main className="auth-layout"><section className="auth-story"><a className="brand" href="/">Lab<span>Slot</span><small>RESOURCE DESK</small></a><div><p className="kicker">{role === "ADMIN" ? setupAdmin ? "LOCAL ADMIN ACCOUNT CREATION" : "ADMINISTRATOR PORTAL" : "STUDENT PORTAL"}</p><h1>{role === "ADMIN" ? <>{setupAdmin ? "Create an" : "Keep the lab"}<br /><em>{setupAdmin ? "admin account." : "in good order."}</em></> : <>Make room for<br /><em>the next discovery.</em></>}</h1><p>{role === "ADMIN" ? setupAdmin ? "Create an administrator account from this computer. The account will be ready to use immediately." : "Manage equipment and make informed booking decisions." : "Find shared equipment, request a time, and keep your practical work moving."}</p></div><div className="story-index"><span>LABSLOT</span><a href="/">SWITCH PORTAL ↗</a></div></section><section className="auth-panel"><p className="kicker">{setupAdmin ? "CREATE ADMINISTRATOR ACCOUNT" : role === "ADMIN" ? "ADMINISTRATOR SIGN IN" : register ? "STUDENT REGISTRATION" : "STUDENT SIGN IN"}</p><h2>{setupAdmin ? "Create administrator account" : register ? "Create your student account" : role === "ADMIN" ? "Administrator sign in" : "Student sign in"}</h2><p className="muted">{setupAdmin ? "This option is available only from the computer running LabSlot." : register ? "Register with your institution email to get started." : role === "ADMIN" ? "Sign in with your administrator account." : "Use your student account to view equipment and bookings."}</p>{message && <div className={`notice ${message.kind}`} role="status">{message.text}</div>}<form className="auth-form" onSubmit={submit}>{(register || setupAdmin) && <label>Full name<input maxLength="100" autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>}<label>Email<input type="email" maxLength="190" autoComplete="username" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required /></label><label>Password<input type="password" minLength="8" maxLength="72" autoComplete={register || setupAdmin ? "new-password" : "current-password"} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required /></label><button className="button primary full" type="submit" disabled={busy}>{busy ? "Please wait…" : setupAdmin ? "Create administrator and sign in" : register ? "Create student account" : role === "ADMIN" ? "Enter administrator portal" : "Enter student portal"}</button></form>{role === "ADMIN" && adminSignupAvailable && <p className="switch-auth">Need an administrator account? <button onClick={() => { setMode(setupAdmin ? "login" : "setup-admin"); }}> {setupAdmin ? "Back to sign in" : "Create account"}</button></p>}{role === "STUDENT" && <p className="switch-auth">{register ? "Already registered?" : "New student?"} <button onClick={() => setMode(register ? "login" : "register")}>{register ? "Sign in" : "Create an account"}</button></p>}</section></main>;
}

function AdminOverview({ summary, bookings, openBookings, openApproved, decide }) {
  const metrics = [["Equipment records", summary.equipmentCount ?? 0], ["Available", summary.availableEquipmentCount ?? 0], ["Pending requests", summary.pendingBookings ?? 0], ["Approved", summary.approvedBookings ?? 0]];
  return <><section className="metric-grid">{metrics.map(([label, value]) => label === "Approved" ? <button type="button" className="metric metric-action" key={label} onClick={openApproved} aria-label={`Show ${value} approved bookings`}><span>{label}</span><strong>{value}</strong><small>View approved bookings →</small></button> : label === "Pending requests" ? <button type="button" className="metric metric-action" key={label} onClick={openBookings} aria-label={`Show ${value} pending requests`}><span>{label}</span><strong>{value}</strong><small>View pending requests →</small></button> : <article className="metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section><section className="section-block"><div className="section-heading"><div><p className="kicker">REVIEW QUEUE</p><h2>Requests to decide</h2></div><button className="text-button" onClick={openBookings}>All booking history →</button></div><BookingTable rows={bookings.slice(0, 5)} admin compact decide={decide} /></section></>;
}

function StudentOverview({ equipment, bookings, choose, setView }) {
  const pending = bookings.filter(row => row.status === "PENDING").length;
  const approved = bookings.filter(row => row.status === "APPROVED").length;
  return <><section className="metric-grid"><article className="metric"><span>Equipment listed</span><strong>{equipment.length}</strong></article><article className="metric"><span>Pending requests</span><strong>{pending}</strong></article><article className="metric"><span>Approved bookings</span><strong>{approved}</strong></article><article className="metric"><span>Booking history</span><strong>{bookings.length}</strong></article></section><section className="section-block"><div className="section-heading"><div><p className="kicker">AVAILABLE NOW</p><h2>Equipment to explore</h2></div><button className="text-button" onClick={() => setView("equipment")}>Browse all →</button></div><div className="equipment-grid">{equipment.slice(0, 3).map(item => <EquipmentCard key={item.id} item={item} choose={choose} />)}</div>{equipment.length === 0 && <Empty>No equipment is available yet.</Empty>}</section><section className="section-block"><div className="section-heading"><div><p className="kicker">RECENT ACTIVITY</p><h2>Latest bookings</h2></div><button className="text-button" onClick={() => setView("bookings")}>See history →</button></div><BookingTable rows={bookings.slice(0, 5)} /></section></>;
}

function EquipmentView({ items, search, setSearch, reload, admin, choose, edit, remove }) {
  return <section className="section-block"><div className="toolbar"><label className="search-box"><span>⌕</span><input aria-label="Search by equipment name or category" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => event.key === "Enter" && reload()} placeholder="Search name or category" /></label><button className="button outline" onClick={reload}>Search</button></div><div className="equipment-grid">{items.map(item => <EquipmentCard key={item.id} item={item} admin={admin} choose={choose} edit={edit} remove={remove} />)}</div>{items.length === 0 && <Empty>No equipment matched this search.</Empty>}</section>;
}

function EquipmentCard({ item, admin, choose, edit, remove }) {
  return <article className="equipment-card"><div className="card-label-row"><span className="category">{item.category}</span><Status value={item.availabilityStatus} /></div><h3>{item.name}</h3><p className="description">{item.description}</p><div className="card-meta"><span>{item.location}</span><span>{item.quantity} unit{item.quantity === 1 ? "" : "s"}</span></div><div className="card-actions">{admin ? <><button className="text-button" onClick={() => edit(item)}>Edit</button><button className="text-button danger" onClick={() => remove(item)}>Delete</button></> : <button className="button primary" disabled={item.availabilityStatus !== "AVAILABLE"} onClick={() => choose(item)}>Request a time <span>↗</span></button>}</div></article>;
}

function BookingTable({ rows, admin = false, compact = false, counts = {}, filter, setFilter, cancel, decide = () => {} }) {
  const shown = filter && filter !== "ALL" ? rows.filter(row => row.status === filter) : rows;
  const statusOptions = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
  const selectedCount = filter === "ALL" ? shown.length : counts[filter] ?? shown.length;
  return <div className="table-area">{!compact && filter !== undefined && <div className="table-tools"><label htmlFor="status-filter">Status</label><select id="status-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="ALL">All bookings ({Object.values(counts).reduce((sum, count) => sum + count, 0)})</option>{statusOptions.map(status => <option key={status} value={status}>{status} ({counts[status] ?? 0})</option>)}</select>{filter !== "ALL" && <strong className="filter-count">{selectedCount} {filter.toLowerCase()} booking{selectedCount === 1 ? "" : "s"}</strong>}</div>}<div className="table-scroll"><table><thead><tr>{admin && <th>Student</th>}<th>Equipment</th><th>Date & time</th><th>Purpose</th><th>Status</th><th>Action</th></tr></thead><tbody>{shown.map(row => <tr key={row.id}>{admin && <td>{row.studentName}</td>}<td><strong>{row.equipmentName}</strong></td><td><DateTime booking={row} /></td><td>{row.purpose}</td><td><Status value={row.status} /></td><td className="actions">{admin && row.status === "PENDING" ? <><button className="text-button" onClick={() => decide(row.id, "approve")}>Approve</button><button className="text-button danger" onClick={() => decide(row.id, "reject")}>Reject</button></> : !admin && (row.status === "PENDING" || row.status === "APPROVED") && new Date(`${row.bookingDate}T${row.startTime}`) > new Date() ? <button className="text-button danger" onClick={() => cancel?.(row.id)}>Cancel</button> : "—"}</td></tr>)}{shown.length === 0 && <tr><td colSpan={admin ? 6 : 5}><Empty>No bookings in this view.</Empty></td></tr>}</tbody></table></div></div>;
}

function Empty({ children }) { return <div className="empty-state">{children}</div>; }

createRoot(document.getElementById("root")).render(<App />);