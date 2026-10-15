const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
// Railway terminates HTTPS at its proxy; trust the forwarded protocol so
// express-session can issue secure cookies for production requests.
app.set('trust proxy', 1);
const db = new Database(path.join(__dirname, 'trevox.db'));
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const REFERRAL_REWARD = Math.max(0, Number(process.env.REFERRAL_REWARD || 0.10));
const WELCOME_BONUS = Math.max(0, Number(process.env.WELCOME_BONUS || 0.50));
const WITHDRAWAL_FEE_RATE = Math.min(0.25, Math.max(0, Number(process.env.WITHDRAWAL_FEE_RATE || 0.10)));
const MIN_WITHDRAWAL = Math.max(3, Number(process.env.MIN_WITHDRAWAL || 3));
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-this-session-secret';
if (process.env.NODE_ENV === 'production' && SESSION_SECRET === 'dev-only-change-this-session-secret') {
  throw new Error('Set SESSION_SECRET in production.');
}

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 referral_code TEXT NOT NULL UNIQUE,
 referred_by INTEGER,
 balance REAL NOT NULL DEFAULT 0,
 signup_ip TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 is_admin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS referrals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 referrer_id INTEGER NOT NULL,
 referred_user_id INTEGER NOT NULL UNIQUE,
 reward REAL NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 fee REAL NOT NULL DEFAULT 0,
 payout_amount REAL NOT NULL DEFAULT 0,
 wallet_address TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 admin_note TEXT,
 reviewed_by INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 event_type TEXT NOT NULL,
 ip TEXT,
 details TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
// Lightweight schema migration for databases created by the earlier Trevox starter.
const withdrawalColumns = db.prepare('PRAGMA table_info(withdrawals)').all().map(c => c.name);
if (!withdrawalColumns.includes('fee')) db.exec('ALTER TABLE withdrawals ADD COLUMN fee REAL NOT NULL DEFAULT 0');
if (!withdrawalColumns.includes('payout_amount')) db.exec('ALTER TABLE withdrawals ADD COLUMN payout_amount REAL NOT NULL DEFAULT 0');
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-before-deploying';
if (!db.prepare('SELECT id FROM users WHERE is_admin=1 LIMIT 1').get()) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  db.prepare(`INSERT INTO users(username,email,password_hash,referral_code,is_admin)
    VALUES(?,?,?,?,1)`).run(adminUsername, `${adminUsername}@trevox.local`, hash, code);
}
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));
app.use(session({
 secret: SESSION_SECRET, resave: false, saveUninitialized: false,
 cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000*60*60*8 }
}));
app.use(express.static(path.join(__dirname, 'public')));
const getUser = req => req.session.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId) : null;
const ipOf = req => (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
const event = (uid, type, ip, details='') => db.prepare(
 'INSERT INTO events(user_id,event_type,ip,details) VALUES(?,?,?,?)').run(uid || null, type, ip, details);
function requireAuth(req,res,next){ if(!getUser(req)) return res.redirect('/login'); next(); }
function requireAdmin(req,res,next){ const u=getUser(req); if(!u || !u.is_admin) return res.redirect('/admin/login'); next(); }
function page(title, body, user=null) {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>${title} · Trevox</title><link rel="stylesheet" href="/style.css"></head><body>
 <nav class="nav"><a class="brand" href="/"><span class="brandmark">T</span> trevox<span class="dot">.</span></a>
 <div class="navlinks">${user ? `<a href="/dashboard">Dashboard</a><a href="/logout">Sign out</a>` : `<a href="/#how">How it works</a><a href="/login">Log in</a><a class="btn btn-small" href="/register">Get started</a>`}</div></nav>
 <main class="wrap">${body}</main><footer>© ${new Date().getFullYear()} Trevox · Referral rewards, clearly tracked. <span>No deposits required.</span></footer></body></html>`;
}
function notice(req){ const n=req.session.notice; delete req.session.notice; return n ? `<div class="notice">${escapeHtml(n)}</div>` : ''; }
function escapeHtml(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function money(n){ return '$'+Number(n||0).toFixed(2); }

app.get('/', (req,res)=>{
 const ref = String(req.query.ref || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,20);
 if(ref) req.session.referralCode = ref;
 const u=getUser(req);
 res.send(page('Fast. Secure. Global', `
 <section class="hero"><div class="hero-shade"></div><div class="hero-content">
 <div class="eyebrow"><span class="pulse"></span> A simpler way to share and earn</div>
 <h1>Share links.<br><em>Earn rewards.</em></h1>
 <p class="lead">Trevox is a free referral rewards platform. Share your invite link, welcome new members, and track eligible rewards from one clean dashboard.</p>
 <div class="hero-actions"><a class="btn" href="${u?'/dashboard':'/register'}">Create free account <span>↗</span></a><a class="btn btn-ghost" href="#how">How it works</a></div>
 <div class="trust-row"><span>✓ No deposit required</span><span>✓ Transparent tracking</span><span>✓ USDT BEP20 withdrawals</span></div>
 </div><div class="hero-card"><div class="card-top"><span>REFERRAL REWARD</span><span class="live-dot">● LIVE</span></div><div class="big-number">$0.10</div><p>Welcome bonus + referral rewards</p><div class="mini-rule"></div><div class="card-bottom"><span>Welcome bonus</span><b>$0.50</b></div><div class="card-bottom"><span>Minimum withdrawal</span><b>$3.00</b></div><div class="card-bottom"><span>Network</span><b>USDT · BEP20</b></div></div></section>
 <section id="how" class="section"><div class="section-head"><span class="kicker">HOW TREVOX WORKS</span><h2>Simple by design.</h2><p>No complicated plans. Just invite, track, and request a payout when you reach the minimum.</p></div>
 <div class="steps"><article><span class="stepno">01</span><h3>Create your account</h3><p>Sign up for free and get your personal referral link.</p></article><article><span class="stepno">02</span><h3>Share your link</h3><p>Share it with real people. Eligible new members are tracked to your account; referrals earn $0.10 each.</p></article><article><span class="stepno">03</span><h3>Request a payout</h3><p>At $3 or more, submit your USDT BEP20 address for admin review. A 10% processing fee is deducted from the requested amount.</p></article></div></section>
 <section class="bottom-cta"><div><span class="kicker">YOUR LINK. YOUR COMMUNITY.</span><h2>Start sharing with Trevox.</h2><p>Free to join. No deposit needed.</p></div><a class="btn" href="${u?'/dashboard':'/register'}">Get started <span>↗</span></a></section>
 `,u));
});
app.get('/register',(req,res)=>res.send(page('Create account',`${notice(req)}<section class="auth"><div class="auth-intro"><span class="kicker">JOIN TREVOX</span><h1>Make sharing<br><em>count.</em></h1><p>Create a free account to get your personal referral link.</p><div class="auth-note">No deposits. No wallet connection. Never share a seed phrase.</div></div><form class="form-card" method="post" action="/register"><h2>Create account</h2><p class="muted">All fields are required.</p><label>Username<input name="username" minlength="3" maxlength="24" required autocomplete="username"></label><label>Email address<input type="email" name="email" required autocomplete="email"></label><label>Password<input type="password" name="password" minlength="10" required autocomplete="new-password"><small>Use at least 10 characters.</small></label><button class="btn full">Create account <span>↗</span></button><p class="form-foot">Already a member? <a href="/login">Log in</a></p></form></section>`)));
app.post('/register',(req,res)=>{
 const username=String(req.body.username||'').trim(), email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
 if(!/^[a-zA-Z0-9_]{3,24}$/.test(username)||!email.includes('@')||password.length<10){req.session.notice='Check your details. Username must be 3–24 letters/numbers/underscores and password at least 10 characters.';return res.redirect('/register');}
 const ip=ipOf(req), refCode=req.session.referralCode; let referrer=null;
 if(refCode) referrer=db.prepare('SELECT id FROM users WHERE referral_code=? AND is_admin=0').get(refCode);
 if(referrer && db.prepare('SELECT id FROM users WHERE id=?').get(referrer.id)) {
   const count=db.prepare('SELECT COUNT(*) c FROM users WHERE signup_ip=?').get(ip).c;
   if(count>=5) event(null,'signup_ip_cluster',ip,`At least ${count} prior accounts share this IP`);
 }
 try {
   const code=crypto.randomBytes(5).toString('hex').toUpperCase();
   const info=db.prepare('INSERT INTO users(username,email,password_hash,referral_code,referred_by,signup_ip,balance) VALUES(?,?,?,?,?,?,?)')
    .run(username,email,bcrypt.hashSync(password,12),code,referrer?referrer.id:null,ip,WELCOME_BONUS);
   const id=Number(info.lastInsertRowid);
   event(id,'signup',ip,referrer?`referrer:${referrer.id}`:'organic');
   if (WELCOME_BONUS > 0) event(id,'welcome_bonus',ip,`${money(WELCOME_BONUS)} welcome bonus credited`);
   if(referrer && referrer.id!==id) {
     db.prepare('INSERT INTO referrals(referrer_id,referred_user_id,reward) VALUES(?,?,?)').run(referrer.id,id,REFERRAL_REWARD);
     db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(REFERRAL_REWARD,referrer.id);
     event(referrer.id,'referral_reward',ip,`${money(REFERRAL_REWARD)} credited for user ${id}`);
   }
   req.session.userId=id; delete req.session.referralCode; res.redirect('/dashboard');
 } catch(e) { req.session.notice='That username or email may already be registered.';res.redirect('/register'); }
});
app.get('/login',(req,res)=>res.send(page('Log in',`${notice(req)}<section class="auth auth-single"><form class="form-card" method="post" action="/login"><span class="kicker">WELCOME BACK</span><h2>Log in to Trevox</h2><label>Email address<input type="email" name="email" required autocomplete="email"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button class="btn full">Log in <span>↗</span></button><p class="form-foot">New here? <a href="/register">Create an account</a></p></form></section>`)));
app.post('/login',(req,res)=>{
 const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email||'').toLowerCase().trim());
 if(!u||!bcrypt.compareSync(String(req.body.password||''),u.password_hash)){req.session.notice='Invalid email or password.';return res.redirect('/login');}
 req.session.userId=u.id; event(u.id,'login',ipOf(req));res.redirect(u.is_admin?'/admin':'/dashboard');
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));
app.get('/dashboard',requireAuth,(req,res)=>{
 const u=getUser(req), refs=db.prepare('SELECT COUNT(*) c FROM referrals WHERE referrer_id=?').get(u.id).c;
 const withdrawals=db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 8').all(u.id);
 const referralUrl=`${SITE_URL}/?ref=${u.referral_code}`;
 res.send(page('Dashboard',`${notice(req)}<div class="dash-head"><div><span class="kicker">YOUR WORKSPACE</span><h1>Good to see you, ${escapeHtml(u.username)}.</h1><p class="muted">Here’s your Trevox account at a glance.</p></div><span class="status-pill">● Account active</span></div>
 <div class="stats"><div class="stat-card"><span>Available balance</span><strong>${money(u.balance)}</strong><small>Eligible referral rewards</small></div><div class="stat-card"><span>Successful referrals</span><strong>${refs}</strong><small>${money(refs*REFERRAL_REWARD)} total credited</small></div><div class="stat-card"><span>Minimum payout</span><strong>${money(MIN_WITHDRAWAL)}</strong><small>10% fee · USDT BEP20</small></div></div>
 <div class="dash-grid"><section class="panel"><div class="panel-head"><div><span class="kicker">YOUR INVITE LINK</span><h2>Grow your network</h2></div><span class="iconbox">↗</span></div><p class="muted">Share this link with people who may want to join Trevox.</p><div class="copyrow"><input id="refLink" readonly value="${escapeHtml(referralUrl)}"><button class="btn btn-small" onclick="navigator.clipboard.writeText(document.getElementById('refLink').value).then(()=>this.textContent='Copied!')">Copy link</button></div><div class="reward-line"><span>Reward per eligible referral</span><b>${money(REFERRAL_REWARD)}</b></div><div class="reward-line"><span>Welcome bonus (credited at signup)</span><b>${money(WELCOME_BONUS)}</b></div></section>
 <section class="panel"><div class="panel-head"><div><span class="kicker">WITHDRAW REWARDS</span><h2>Request a payout</h2></div><span class="iconbox">⇧</span></div><p class="muted">Enter a USDT address on the BNB Smart Chain (BEP20). Double-check it before submitting.</p><form method="post" action="/withdraw"><label>Amount (USD)<input type="number" name="amount" min="${MIN_WITHDRAWAL.toFixed(2)}" max="${Number(u.balance).toFixed(2)}" step="0.01" required placeholder="1.00"></label><label>USDT BEP20 wallet address<input name="wallet" minlength="20" maxlength="100" required placeholder="0x…"></label><button class="btn full" ${u.balance<MIN_WITHDRAWAL?'disabled':''}>Submit withdrawal request</button><small>A 10% fee is deducted immediately when you submit. The remaining 90% is the requested payout, pending admin review. Approval does not mean a transfer has been sent.</small></form></section></div>
 <section class="panel table-panel"><div class="panel-head"><div><span class="kicker">ACTIVITY</span><h2>Withdrawal history</h2></div></div>${withdrawals.length?`<div class="table-scroll"><table><thead><tr><th>Request</th><th>Requested</th><th>Fee</th><th>Net payout</th><th>Wallet</th><th>Status</th><th>Date</th></tr></thead><tbody>${withdrawals.map(w=>`<tr><td>#${w.id}</td><td>${money(w.amount)}</td><td>${money(w.fee)}</td><td>${money(w.payout_amount)}</td><td class="wallet">${escapeHtml(w.wallet_address.slice(0,9))}…${escapeHtml(w.wallet_address.slice(-5))}</td><td><span class="badge ${w.status}">${escapeHtml(w.status)}</span></td><td>${escapeHtml(w.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No withdrawal requests yet.</div>'}</section>
 `,u));
});
app.post('/withdraw',requireAuth,(req,res)=>{
 const u=getUser(req), amount=Number(req.body.amount), wallet=String(req.body.wallet||'').trim();
 if(!Number.isFinite(amount)||amount<MIN_WITHDRAWAL||amount>u.balance||!/^0x[a-fA-F0-9]{40}$/.test(wallet)){
  req.session.notice=`Minimum request is ${money(MIN_WITHDRAWAL)}. Check your available balance and enter a valid 0x BEP20 address.`;return res.redirect('/dashboard');
 }
 const ip=ipOf(req);
 const fee=Math.round(amount*WITHDRAWAL_FEE_RATE*100)/100;
 const payoutAmount=Math.round((amount-fee)*100)/100;
 const result=db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?').run(amount,u.id,amount);
 if(!result.changes){req.session.notice='Insufficient available balance.';return res.redirect('/dashboard');}
 const info=db.prepare('INSERT INTO withdrawals(user_id,amount,fee,payout_amount,wallet_address) VALUES(?,?,?,?,?)').run(amount,fee,payoutAmount,wallet);
 event(u.id,'withdrawal_requested',ip,`withdrawal:${info.lastInsertRowid}; requested:${money(amount)}; fee:${money(fee)}; net_payout:${money(payoutAmount)}`);
 res.redirect('/dashboard');
});
app.get('/admin/login',(req,res)=>res.send(page('Admin login',`${notice(req)}<section class="auth auth-single"><form class="form-card" method="post" action="/admin/login"><span class="kicker">RESTRICTED ACCESS</span><h2>Admin sign in</h2><label>Username<input name="username" required autocomplete="username"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button class="btn full">Access admin dashboard</button></form></section>`)));
app.post('/admin/login',(req,res)=>{
 const u=db.prepare('SELECT * FROM users WHERE username=? AND is_admin=1').get(String(req.body.username||'').trim());
 if(!u||!bcrypt.compareSync(String(req.body.password||''),u.password_hash)){req.session.notice='Invalid admin credentials.';return res.redirect('/admin/login');}
 req.session.userId=u.id;event(u.id,'admin_login',ipOf(req));res.redirect('/admin');
});
app.get('/admin',requireAdmin,(req,res)=>{
 const pending=db.prepare(`SELECT w.*,u.username,u.email,u.signup_ip,u.created_at AS user_created FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='pending' ORDER BY w.id ASC`).all();
 const users=db.prepare(`SELECT u.id,u.username,u.email,u.balance,u.signup_ip,u.created_at,u.referred_by,
 (SELECT COUNT(*) FROM users x WHERE x.signup_ip=u.signup_ip) AS ip_accounts,
 (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id=u.id) AS refs
 FROM users u WHERE u.is_admin=0 ORDER BY u.id DESC LIMIT 100`).all();
 const logs=db.prepare(`SELECT e.*,u.username FROM events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 30`).all();
 const sharedIps=db.prepare(`SELECT signup_ip,COUNT(*) c FROM users WHERE is_admin=0 AND signup_ip IS NOT NULL GROUP BY signup_ip HAVING COUNT(*)>1 ORDER BY c DESC LIMIT 12`).all();
 res.send(page('Admin dashboard',`${notice(req)}<div class="dash-head"><div><span class="kicker">TREVOX CONTROL ROOM</span><h1>Admin dashboard</h1><p class="muted">Review requests and investigate account activity.</p></div><a class="btn btn-ghost" href="/logout">Sign out</a></div>
 <div class="stats"><div class="stat-card"><span>Pending withdrawals</span><strong>${pending.length}</strong><small>Awaiting review</small></div><div class="stat-card"><span>Registered members</span><strong>${db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin=0').get().c}</strong><small>Real accounts</small></div><div class="stat-card"><span>Rewards credited</span><strong>${money(db.prepare('SELECT COALESCE(SUM(reward),0) s FROM referrals').get().s)}</strong><small>Referral ledger</small></div></div>
 <section class="panel table-panel"><div class="panel-head"><div><span class="kicker">PAYOUT QUEUE</span><h2>Withdrawal requests</h2></div></div>${pending.length?`<div class="table-scroll"><table><thead><tr><th>User</th><th>Requested / fee / net</th><th>Wallet</th><th>Risk signals</th><th>Decision</th></tr></thead><tbody>${pending.map(w=>`<tr><td><b>${escapeHtml(w.username)}</b><br><small>${escapeHtml(w.email)}</small></td><td><b>${money(w.amount)}</b><br><small>Fee ${money(w.fee)} · Net ${money(w.payout_amount)}</small></td><td class="wallet">${escapeHtml(w.wallet_address)}</td><td>${Number(db.prepare('SELECT COUNT(*) c FROM users WHERE signup_ip=?').get(w.signup_ip).c)>1?`<span class="badge pending">Shared IP</span>`:'<span class="badge approved">No IP cluster</span>'}<br><small>${escapeHtml(w.signup_ip||'unknown')} · joined ${escapeHtml(w.user_created)}</small></td><td><form class="decision" method="post" action="/admin/withdraw/${w.id}"><input name="note" placeholder="Admin note (optional)" maxlength="240"><button name="decision" value="approve" class="btn btn-small">Approve</button><button name="decision" value="reject" class="btn btn-small btn-danger">Reject</button></form></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No pending withdrawals. You’re all caught up.</div>'}</section>
 <div class="admin-grid"><section class="panel table-panel"><div class="panel-head"><div><span class="kicker">ABUSE REVIEW</span><h2>Shared signup IPs</h2></div></div><p class="muted">IP overlap is only a signal, not proof of abuse. Review context before acting.</p>${sharedIps.length?`<div class="table-scroll"><table><thead><tr><th>IP</th><th>Accounts</th></tr></thead><tbody>${sharedIps.map(x=>`<tr><td>${escapeHtml(x.signup_ip||'unknown')}</td><td><span class="badge pending">${x.c}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No shared IP clusters found.</div>'}</section>
 <section class="panel table-panel"><div class="panel-head"><div><span class="kicker">MEMBER DIRECTORY</span><h2>Recent accounts</h2></div></div><div class="table-scroll"><table><thead><tr><th>Member</th><th>Balance</th><th>Referrals</th><th>IP accounts</th></tr></thead><tbody>${users.map(x=>`<tr><td><b>${escapeHtml(x.username)}</b><br><small>${escapeHtml(x.email)}</small></td><td>${money(x.balance)}</td><td>${x.refs}</td><td>${x.ip_accounts>1?`<span class="badge pending">${x.ip_accounts}</span>`:x.ip_accounts}</td></tr>`).join('')}</tbody></table></div></section></div>
 <section class="panel table-panel"><div class="panel-head"><div><span class="kicker">AUDIT TRAIL</span><h2>Recent events</h2></div></div><div class="table-scroll"><table><thead><tr><th>Event</th><th>User</th><th>IP</th><th>Details</th><th>Time</th></tr></thead><tbody>${logs.map(x=>`<tr><td>${escapeHtml(x.event_type)}</td><td>${escapeHtml(x.username||'system')}</td><td>${escapeHtml(x.ip||'—')}</td><td>${escapeHtml(x.details||'—')}</td><td>${escapeHtml(x.created_at)}</td></tr>`).join('')}</tbody></table></div></section>
 `,getUser(req)));
});
app.post('/admin/withdraw/:id',requireAdmin,(req,res)=>{
 const id=Number(req.params.id), decision=String(req.body.decision), note=String(req.body.note||'').slice(0,240);
 const w=db.prepare('SELECT * FROM withdrawals WHERE id=? AND status=?').get(id,'pending');
 if(!w){req.session.notice='This request was already reviewed or does not exist.';return res.redirect('/admin');}
 if(!['approve','reject'].includes(decision)){req.session.notice='Invalid decision.';return res.redirect('/admin');}
 const status=decision==='approve'?'approved':'rejected';
 const tx=db.transaction(()=>{
  db.prepare('UPDATE withdrawals SET status=?,admin_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status=?').run(status,note,getUser(req).id,id,'pending');
  if(status==='rejected') db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(w.amount,w.user_id);
  event(w.user_id,`withdrawal_${status}`,ipOf(req),`withdrawal:${id}; note:${note}`);
 });
 tx(); req.session.notice=`Withdrawal #${id} ${status}. ${status==='approved'?'This records approval only; send the net payout separately and record the transaction hash in your payout ledger.':'The amount was returned to the member balance.'}`;
 res.redirect('/admin');
});
app.use((req,res)=>res.status(404).send(page('Not found','<section class="empty-page"><h1>Page not found</h1><p>The page you are looking for doesn’t exist.</p><a class="btn" href="/">Back home</a></section>',getUser(req))));
app.listen(PORT,()=>console.log(`Trevox running on ${SITE_URL}`));
