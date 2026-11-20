import React, { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { Icon, Avatar, Empty, Skeleton, Verified } from '../components/UI.jsx';
import { API, api } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';

function Bar({ data, label }) {
  const max = Math.max(1, ...data.map(d => d.c));
  return (
    <div className="mini-chart">
      {data.length === 0 && <p className="muted small">No data yet.</p>}
      {data.map((d, i) => (
        <div key={i} className="mc-col" title={`${d.d}: ${d.c}`}>
          <div className="mc-bar" style={{ height: `${Math.max(6, (d.c / max) * 100)}%` }} />
          <small>{d.d?.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}

export default function Admin() {
  const { user, notify } = useApp();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState(null);
  const [reports, setReports] = useState(null);
  const [audit, setAudit] = useState(null);
  const [integ, setInteg] = useState(null);
  const [q, setQ] = useState('');

  const loadStats = () => API.adminStats().then(setStats).catch(e => notify(e.message, 'err'));
  const loadUsers = () => API.adminUsers(q).then(r => setUsers(r.users || [])).catch(() => setUsers([]));
  const loadReports = () => API.adminReports().then(r => setReports(r.reports || [])).catch(() => setReports([]));
  const loadAudit = () => api('/admin/audit').then(r => setAudit(r.audit || r.logs || [])).catch(() => setAudit([]));

  useEffect(() => { loadStats(); loadReports(); }, []);
  useEffect(() => {
    if (tab === 'users') loadUsers();
    if (tab === 'audit') loadAudit();
    if (tab === 'integrations') API.adminIntegrations().then(setInteg).catch(() => setInteg({ rows: [], groups: [] }));
  }, [tab, q]);

  const verify = async (u) => { try { await API.adminVerify(u.id); notify('Verification toggled', 'ok'); loadUsers(); } catch (e) { notify(e.message, 'err'); } };
  const setStatus = async (u, status) => { try { await API.adminStatus(u.id, status); notify(`User ${status}`, 'ok'); loadUsers(); } catch (e) { notify(e.message, 'err'); } };
  const resolve = async (r) => { try { await API.adminResolve(r.id); notify('Report resolved', 'ok'); loadReports(); loadStats(); } catch (e) { notify(e.message, 'err'); } };

  return (
    <div className="page page-wide admin-page">
      <div className="page-head">
        <div><h1>Admin <span className="grad-text">Console</span></h1><p className="muted">Role-based moderation, analytics and platform health.</p></div>
        <span className="pill admin-pill"><Icon name="shield" size={13} /> {user.role}</span>
      </div>

      <div className="seg-tabs">
        {['overview', 'users', 'reports', 'integrations', 'audit'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'integrations' ? 'Integrations' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        stats === null ? <div className="card-grid">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div> : (
          <>
            <div className="stat-grid">
              {[
                { k: 'Users', v: stats.users, icon: 'users', sub: `${stats.active24} active 24h` },
                { k: 'Messages', v: stats.messages, icon: 'chat', sub: `${stats.msgs24} today` },
                { k: 'Posts', v: stats.posts, icon: 'grid', sub: `${stats.moments} moments` },
                { k: 'Communities', v: stats.communities, icon: 'users', sub: `${stats.calls} calls` },
                { k: 'Translations', v: stats.translations, icon: 'translate', sub: `${stats.translationUsage?.[0]?.provider || '—'} provider` },
                { k: 'Open reports', v: stats.openReports, icon: 'warning', sub: `${stats.suspended} suspended` },
              ].map(s => (
                <div key={s.k} className="stat-card card">
                  <span className="stat-ic"><Icon name={s.icon} size={18} /></span>
                  <b>{s.v}</b><span>{s.k}</span><small className="muted">{s.sub}</small>
                </div>
              ))}
            </div>
            <div className="admin-charts">
              <div className="card"><h3>Registrations</h3><Bar data={stats.registrations || []} /></div>
              <div className="card"><h3>Message volume</h3><Bar data={stats.messageVolume || []} /></div>
              <div className="card"><h3>Languages</h3>
                <div className="lang-bars">
                  {(stats.languages || []).map(l => (
                    <div key={l.language} className="lb-row"><span>{l.language.toUpperCase()}</span><div className="lb-track"><i style={{ width: `${(l.c / Math.max(...stats.languages.map(x => x.c))) * 100}%` }} /></div><b>{l.c}</b></div>
                  ))}
                </div>
              </div>
              <div className="card"><h3>System</h3>
                <div className="sys-list">
                  <div><span>Engine</span><b>{stats.engine}</b></div>
                  <div><span>Database</span><b>{stats.system?.db}</b></div>
                  <div><span>Realtime</span><b>{stats.system?.realtime}</b></div>
                  <div><span>Node</span><b>{stats.system?.node}</b></div>
                  <div><span>Uptime</span><b>{Math.round(stats.system?.uptime || 0)}s</b></div>
                  <div><span>Memory</span><b>{Math.round((stats.system?.memory || 0) / 1048576)} MB</b></div>
                </div>
              </div>
            </div>
          </>
        )
      )}

      {tab === 'users' && (
        <div className="card">
          <div className="explore-search"><Icon name="search" size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search users…" /></div>
          {users === null && [1, 2, 3].map(i => <Skeleton key={i} h={54} style={{ marginBottom: 8 }} />)}
          <div className="admin-users">
            {users && users.map(u => (
              <div key={u.id} className="admin-user-row">
                <Avatar user={u} size={40} />
                <div className="au-info">
                  <b>{u.displayName} {u.verified && <Verified />} {u.role !== 'user' && <span className="pill">{u.role}</span>}</b>
                  <small>@{u.username} · {u.email || u.phone} · {u.status} · joined {timeAgo(u.createdAt)}</small>
                </div>
                <div className="au-actions">
                  <button className="btn ghost btn-sm" onClick={() => verify(u)}>{u.verified ? 'Unverify' : 'Verify'}</button>
                  {u.status === 'active'
                    ? <button className="btn ghost btn-sm" onClick={() => setStatus(u, 'suspended')}>Suspend</button>
                    : <button className="btn ghost btn-sm" onClick={() => setStatus(u, 'active')}>Restore</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <div className="card">
          {reports === null && <Skeleton h={80} />}
          {reports && reports.length === 0 && <Empty icon="shield" title="No reports" text="The queue is clear." />}
          {reports && reports.map(r => (
            <div key={r.id} className="report-row">
              <span className={`report-badge ${r.status}`}>{r.status}</span>
              <div>
                <b>{r.reason} · {r.target_type}</b>
                <p className="muted small">{r.details}</p>
                <small>by @{r.reporter?.username} · {timeAgo(r.created_at)}</small>
              </div>
              {r.status === 'open' && <button className="btn primary btn-sm" onClick={() => resolve(r)}>Resolve</button>}
            </div>
          ))}
        </div>
      )}

      {tab === 'integrations' && (
        <div className="integ">
          <div className="integ-head">
            <div>
              <h2>API integrations</h2>
              <p className="muted small">
                Live status of every provider. Keys are read from environment variables on the
                server — paste them into your Render environment (or <code>.env</code>), redeploy,
                and this page updates. Secrets are never sent to the browser.
              </p>
            </div>
          </div>

          {integ === null && <Skeleton h={80} />}

          {integ && (
            <>
              <div className="integ-groups">
                {integ.groups.map(g => (
                  <div key={g.id} className={`integ-group ${g.ready === g.total ? 'ok' : g.ready ? 'part' : 'off'}`}>
                    <b>{g.label}</b>
                    <span>{g.ready}/{g.total} ready</span>
                  </div>
                ))}
              </div>

              {['ai', 'translation', 'sms', 'calling', 'auth'].map(group => {
                const rows = integ.rows.filter(r => r.group === group);
                if (!rows.length) return null;
                const label = integ.groups.find(g => g.id === group)?.label || group;
                return (
                  <div key={group} className="card integ-card">
                    <div className="integ-card-head">
                      <h3>{label}</h3>
                    </div>
                    <div className="integ-rows">
                      {rows.map(r => (
                        <div key={r.id} className={`integ-row ${r.ready ? 'ok' : 'off'}`}>
                          <span className={`integ-dot ${r.ready ? 'ok' : 'off'}`} />
                          <div className="integ-row-main">
                            <b>{r.label}</b>
                            <small>{r.detail}</small>
                          </div>
                          <div className="integ-env">
                            {r.envKeys.map(k => <code key={k}>{k}</code>)}
                          </div>
                          <span className={`integ-state ${r.ready ? 'ok' : 'off'}`}>
                            {r.ready ? 'Live' : 'Not set'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="card integ-note">
                <Icon name="info" size={16} />
                <div>
                  <b>Active AI engine:</b> <code>{integ.activeAi}</code>
                  <br />
                  <b>Translation chain:</b> <code>{integ.activeTranslation.join(' → ')}</code>
                  <br />
                  <b>OTP channel:</b> <code>{integ.smsProvider}</code>
                  {!integ.hasTurn && <><br /><b>TURN:</b> not configured — mobile-to-mobile calls may fail.</>}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          {audit === null && <Skeleton h={60} />}
          {audit && audit.length === 0 && <Empty icon="chart" title="No audit entries" text="Actions will appear here." />}
          {audit && audit.map(a => (
            <div key={a.id} className="audit-row">
              <Icon name="shield" size={15} />
              <div><b>{a.action}</b><small>{a.target || '—'} · {timeAgo(a.created_at)}</small></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
