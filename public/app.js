const app = document.getElementById('app');
let me = null;
let page = 'dashboard';
let practice = null;
let practiceStartedAt = null;
let practiceAnswered = false;
let practiceSelected = null;
let practiceHints = [];
let lastResult = null;
let chatSession = null;
let practiceBookmarked = false;
let practiceFilters = { section: '', domain: '', skill: '', difficulty: '', frequency: '' };
let adminQuestionFilters = { search: '', section: '', domain: '', skill: '', difficulty: '', frequency: '', status: '' };
let testTimerInterval = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (s) => s == null || s === '' ? '-' : String(s);
const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
const difficultyLabel = (d) => ['','Easy','Easy-Medium','Medium','Medium-Hard','Hard'][Number(d)] || `Level ${d}`;
const frequencyLabel = (f) => ({very_common:'Very common',common:'Common',moderate:'Moderate',less_common:'Less common',unknown:'Not classified'}[f] || f || 'Not classified');

let pendingApiRequests = 0;

async function api(path, opts = {}) {
  pendingApiRequests++;
  document.body.classList.add('is-loading');
  try {
    const r = await fetch(path, {
      credentials: 'same-origin',
      ...opts,
      headers: {'content-type':'application/json', ...(opts.headers || {})}
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  } finally {
    pendingApiRequests = Math.max(0, pendingApiRequests - 1);
    if (pendingApiRequests === 0) document.body.classList.remove('is-loading');
  }
}

function renderPasswordStrengthUI(container, pwd) {
  if (!container) return;
  if (!pwd) { container.innerHTML = ''; return; }
  const minLength = pwd.length >= 8;
  const hasUpper = /[A-Z]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasNum = /[0-9]/.test(pwd);
  const hasSpec = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd);
  
  let score = 0;
  if (minLength) score++;
  if (hasUpper && hasLower) score++;
  if (hasNum) score++;
  if (hasSpec) score++;

  const scoreLabels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  container.innerHTML = `
    <div class="pwdStrengthWrap pwdScore-${score}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:600;">Password strength: ${scoreLabels[score]}</span>
      </div>
      <div class="pwdBar">
        <div class="pwdSegment seg-0"></div>
        <div class="pwdSegment seg-1"></div>
        <div class="pwdSegment seg-2"></div>
        <div class="pwdSegment seg-3"></div>
      </div>
      <ul class="pwdRulesList">
        <li class="pwdRuleItem ${minLength?'pass':'fail'}">8+ characters</li>
        <li class="pwdRuleItem ${hasUpper?'pass':'fail'}">Uppercase (A-Z)</li>
        <li class="pwdRuleItem ${hasLower?'pass':'fail'}">Lowercase (a-z)</li>
        <li class="pwdRuleItem ${hasNum?'pass':'fail'}">Number (0-9)</li>
        <li class="pwdRuleItem ${hasSpec?'pass':'fail'}">Special char (!@#$)</li>
      </ul>
    </div>
  `;
}

function authView(mode='login', error='', notice='', unverifiedEmail='') {
  app.innerHTML = `<div class="auth"><div class="card stack authCard">
    <div class="brandMark">SAT Tutor</div>
    <h1>${mode === 'register' ? 'Create your account' : 'Welcome back'}</h1>
    <p class="muted">${mode === 'register' ? 'Build a personalized SAT practice plan.' : 'Continue your adaptive SAT practice.'}</p>
    ${notice ? `<div class="notice" style="background:#ecfdf5;color:#065f46;padding:12px;border-radius:6px;font-size:14px;border:1px solid #a7f3d0;">${esc(notice)}</div>` : ''}
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    ${unverifiedEmail ? `<button class="btn alt" id="resendBtn" style="margin-bottom:8px">Resend verification email to ${esc(unverifiedEmail)}</button>` : ''}
    ${mode==='register' ? `<label class="label">Name<input class="input" id="name" autocomplete="name" minlength="2" required></label>` : ''}
    <label class="label">Email<input class="input" id="email" type="email" autocomplete="email" value="${esc(unverifiedEmail)}" required></label>
    <label class="label">Password<input class="input" id="password" type="password" autocomplete="new-password" minlength="8" required></label>
    <div id="pwdMeter"></div>
    <button class="btn btnPrimary" id="go">${mode==='register'?'Create account':'Log in'}</button>
    ${mode==='login' ? `<button class="btn alt" id="forgotBtn" style="margin-top:4px">Forgot password?</button>` : ''}
    <button class="btn alt" id="switch">${mode==='register'?'I already have an account':'Create a student account'}</button>
  </div></div>`;
  const go = document.getElementById('go');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const nameInput = document.getElementById('name');
  const resendBtn = document.getElementById('resendBtn');
  const forgotBtn = document.getElementById('forgotBtn');
  const pwdMeter = document.getElementById('pwdMeter');

  if (mode === 'register' && passwordInput && pwdMeter) {
    passwordInput.addEventListener('input', () => renderPasswordStrengthUI(pwdMeter, passwordInput.value));
  }

  if (forgotBtn) {
    forgotBtn.onclick = () => forgotPasswordView();
  }

  if (resendBtn) {
    resendBtn.onclick = async () => {
      try {
        const res = await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: unverifiedEmail }) });
        authView('login', '', res.message || 'Verification link sent!');
      } catch(e) {
        authView('login', e.message, '', unverifiedEmail);
      }
    };
  }

  const submit = async () => {
    try {
      const emailValue = emailInput.value.trim().toLowerCase();
      const passwordValue = passwordInput.value;
      const nameValue = nameInput ? nameInput.value.trim() : '';
      if (!emailValue || !/^\S+@\S+\.\S+$/.test(emailValue) || passwordValue.length < 8 || (mode==='register' && nameValue.length < 2)) {
        throw new Error(mode==='register' ? 'Please enter your name, a valid email, and a password of at least 8 characters.' : 'Please enter a valid email and a password of at least 8 characters.');
      }
      const payload = { email: emailValue, password: passwordValue };
      if (mode==='register') payload.name = nameValue;
      const res = await api(mode==='register' ? '/api/auth/register' : '/api/auth/login', { method:'POST', body:JSON.stringify(payload) });
      if (res.requiresVerification) {
        authView('login', '', res.message, emailValue);
        return;
      }
      await boot();
    } catch(e) {
      if (e.message && e.message.includes('Email not verified')) {
        authView('login', e.message, '', emailInput.value.trim().toLowerCase());
      } else {
        authView(mode, e.message);
      }
    }
  };
  go.onclick = submit;
  passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  document.getElementById('switch').onclick = () => authView(mode==='register'?'login':'register');
}

function forgotPasswordView(error='', notice='') {
  app.innerHTML = `<div class="auth"><div class="card stack authCard">
    <div class="brandMark">SAT Tutor</div>
    <h1>Reset your password</h1>
    <p class="muted">Enter your registered email address and we'll send you a password reset link.</p>
    ${notice ? `<div class="notice" style="background:#ecfdf5;color:#065f46;padding:12px;border-radius:6px;font-size:14px;border:1px solid #a7f3d0;">${esc(notice)}</div>` : ''}
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <label class="label">Email<input class="input" id="forgotEmail" type="email" autocomplete="email" required></label>
    <button class="btn btnPrimary" id="sendReset">Send reset link</button>
    <button class="btn alt" id="backToLogin">Back to login</button>
  </div></div>`;

  document.getElementById('sendReset').onclick = async () => {
    try {
      const email = document.getElementById('forgotEmail').value.trim().toLowerCase();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email address.');
      const res = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      forgotPasswordView('', res.message || 'If an account exists with that email, a reset link has been sent.');
    } catch(e) {
      forgotPasswordView(e.message);
    }
  };
  document.getElementById('backToLogin').onclick = () => authView('login');
}

function resetPasswordView(token, error='') {
  app.innerHTML = `<div class="auth"><div class="card stack authCard">
    <div class="brandMark">SAT Tutor</div>
    <h1>Set new password</h1>
    <p class="muted">Enter your new password below.</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <label class="label">New Password<input class="input" id="newPass" type="password" minlength="8" required></label>
    <div id="resetPwdMeter"></div>
    <label class="label">Confirm New Password<input class="input" id="confirmPass" type="password" minlength="8" required></label>
    <button class="btn btnPrimary" id="savePass">Update password</button>
  </div></div>`;

  const newPass = document.getElementById('newPass');
  const resetPwdMeter = document.getElementById('resetPwdMeter');
  if (newPass && resetPwdMeter) {
    newPass.addEventListener('input', () => renderPasswordStrengthUI(resetPwdMeter, newPass.value));
  }

  document.getElementById('savePass').onclick = async () => {
    try {
      const p1 = newPass.value;
      const p2 = document.getElementById('confirmPass').value;
      if (!p1 || p1.length < 8) throw new Error('Password must be at least 8 characters long.');
      if (p1 !== p2) throw new Error('Passwords do not match.');
      const res = await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: p1 }) });
      authView('login', '', res.message || 'Password reset successfully! You can now log in.');
    } catch(e) {
      resetPasswordView(token, e.message);
    }
  };
}

function layout(content) {
  const admin = me.user.role === 'admin';
  app.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brandBlock"><div class="brand">SAT Tutor</div><div class="brandSub">Adaptive SAT prep</div></div>
      <div class="userMini"><div class="avatar">${esc((me.user.name||'S')[0].toUpperCase())}</div><div><b>${esc(me.user.name)}</b><div class="muted sideMuted">${esc(me.user.email)}</div></div></div>
      <nav class="nav">
        <button class="navBtn ${page==='dashboard'?'active':''}" data-p="dashboard"><span>⌂</span> Dashboard</button>
        <button class="navBtn ${page==='practice'?'active':''}" data-p="practice"><span>✓</span> Practice</button>
        <button class="navBtn ${page==='tests'||page==='testrun'?'active':''}" data-p="tests"><span>⏱</span> Practice Tests</button>
        <button class="navBtn ${page==='daily'?'active':''}" data-p="daily"><span>★</span> Daily Challenge</button>
        <button class="navBtn ${page==='mistakes'?'active':''}" data-p="mistakes"><span>↺</span> Mistake Review</button>
        <button class="navBtn ${page==='bookmarks'?'active':''}" data-p="bookmarks"><span>♥</span> Bookmarks</button>
        <button class="navBtn ${page==='studyplan'?'active':''}" data-p="studyplan"><span>▤</span> Study Plan</button>
        <button class="navBtn ${page==='achievements'?'active':''}" data-p="achievements"><span>🏆</span> Achievements</button>
        <button class="navBtn ${page==='tutor'?'active':''}" data-p="tutor"><span>✦</span> AI Tutor</button>
        <button class="navBtn ${page==='progress'?'active':''}" data-p="progress"><span>◔</span> Progress</button>
        ${admin ? `<button class="navBtn ${page==='admin'?'active':''}" data-p="admin"><span>⚙</span> Admin</button>`:''}
        <button class="navBtn logoutBtn" id="logout"><span>↪</span> Log out</button>
      </nav>
      <div class="sideFooter">Keep practicing. Small gains compound.</div>
    </aside>
    <main class="main">${content}</main>
  </div>`;
  document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { page=b.dataset.p; if(page!=='practice'){practice=null;practiceSelected=null;lastResult=null;} render(); });
  document.getElementById('logout').onclick = async () => { await api('/api/auth/logout',{method:'POST'}); me=null; page='dashboard'; authView('login'); };
}

async function dashboard() {
  const p = await api('/api/progress');
  const sessRes = await api('/api/auth/sessions').catch(()=>({sessions:[]}));
  const sessions = sessRes.sessions || [];
  const masteryAvg = p.mastery.length ? p.mastery.reduce((a,m)=>a+Number(m.ability||0),0)/p.mastery.length : 500;
  const showDiagnosticBanner = !me.student.diagnostic_completed_at && p.stats.attempts < 3;
  return `${showDiagnosticBanner ? `<div class="card onboardBanner"><div><div class="eyebrow">GET STARTED</div><h2>Take your diagnostic test</h2><p class="muted">A short, mixed-topic assessment across every SAT domain so your practice and study plan start from real data instead of a guess.</p></div><button class="btn btnPrimary" id="startDiagnostic">Start diagnostic (24 questions)</button></div>` : ''}
    <div class="pageHead"><div><div class="eyebrow">STUDENT DASHBOARD</div><h1>Welcome back, ${esc(me.user.name.split(' ')[0])}</h1><p class="muted">Your practice adapts to what you know, what you miss, and what needs review.</p></div><button class="btn btnPrimary" id="start">Start practice</button></div>
    <div class="heroGrid">
      <div class="card heroCard"><div><div class="muted">Current ability estimate</div><div class="heroStat">${Math.round(masteryAvg)}</div><div class="small muted">Internal mastery scale · not an SAT score</div></div><div class="ring"><div>${p.stats.attempts||0}</div><span>attempts</span></div></div>
      <div class="card"><div class="cardTitle">Today</div><div class="metricRows"><div><span>Accuracy</span><b>${pct(p.stats.accuracy)}</b></div><div><span>Reviews due</span><b>${p.due.length}</b></div><div><span>Avg. time</span><b>${Math.round(p.stats.avg_time||0)}s</b></div></div></div>
    </div>
    <div class="grid2 dashboardLower">
      <div class="card"><div class="sectionHead"><h3>Weakest skills</h3><button class="linkBtn" id="progressLink">View all</button></div>${p.mastery.slice(0,6).map(m=>`<div class="skillRow"><div><b>${esc(m.skill)}</b><div class="progress"><i style="width:${Math.max(6,Math.min(100,(Number(m.ability||0)/10)))}%"></i></div></div><span>${Math.round(m.ability)}</span></div>`).join('') || '<p class="muted">Answer a few questions to build your mastery profile.</p>'}</div>
      <div class="card"><div class="sectionHead"><h3>Profile</h3><button class="linkBtn" id="settings">Edit</button></div><div class="profileGrid"><div><span>Target score</span><b>${fmt(me.student.target_score)}</b></div><div><span>Test date</span><b>${fmt(me.student.test_date)}</b></div><div><span>Weekly study</span><b>${me.student.weekly_available_minutes?`${me.student.weekly_available_minutes} min`:'Not set'}</b></div><div><span>Time zone</span><b>${fmt(me.student.timezone)}</b></div></div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="sectionHead"><h3>Connected Devices & Active Sessions</h3>${sessions.length > 1 ? `<button class="btn alt" id="revokeAllBtn">Log out all other devices</button>` : ''}</div>
      <div class="tableWrap"><table class="table"><thead><tr><th>Device / User Agent</th><th>IP Address</th><th>Last Active</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${sessions.map(s => `<tr>
          <td><b>${esc(s.userAgent.slice(0,45))}</b></td>
          <td>${esc(s.ipAddress)}</td>
          <td>${new Date(s.lastActiveAt).toLocaleString()}</td>
          <td>${s.isCurrent ? '<span class="pill approvedPill">Current Device</span>' : '<span class="pill statusPill">Active</span>'}</td>
          <td>${s.isCurrent ? '-' : `<button class="linkBtn" style="color:#b91c1c;" data-revoke-session="${esc(s.id)}">Revoke</button>`}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No active sessions found.</td></tr>'}
      </tbody></table></div>
    <div class="card" style="margin-top:16px;border-color:#fecaca;background:#fff5f5;">
      <div class="sectionHead"><h3 style="color:#991b1b;">Danger Zone</h3></div>
      <p class="muted" style="font-size:13px;margin:4px 0 12px;">Permanently delete your SAT Tutor account, practice history, mastery metrics, and all associated personal data.</p>
      <button class="btn danger" id="deleteAccountBtn">Delete Account</button>
    </div>
  `;
}

function openDeleteAccountModal() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="modalBackdrop"><div class="card stack modal" style="max-width:440px;">
    <h2 style="color:#b91c1c;">Delete Account</h2>
    <p class="muted">This action is permanent and cannot be undone. All your progress, test attempts, and study history will be permanently deleted.</p>
    <label class="label">Re-enter your password to confirm:<input class="input" type="password" id="delConfirmPass" required></label>
    <div id="delErr" style="color:#b91c1c;font-size:13px;"></div>
    <div class="modalActions">
      <button class="btn alt" id="cancelDel">Cancel</button>
      <button class="btn danger" id="confirmDel">Permanently Delete Account</button>
    </div>
  </div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  document.getElementById('cancelDel').onclick = () => document.querySelector('.modalBackdrop').remove();
  document.getElementById('confirmDel').onclick = async () => {
    const pass = document.getElementById('delConfirmPass').value;
    const errDiv = document.getElementById('delErr');
    if (!pass) { errDiv.textContent = 'Please enter your password.'; return; }
    try {
      const res = await api('/api/me', { method: 'DELETE', body: JSON.stringify({ password: pass }) });
      document.querySelector('.modalBackdrop').remove();
      me = null;
      page = 'dashboard';
      authView('login', '', res.message || 'Account successfully deleted.');
    } catch(e) {
      errDiv.textContent = e.message;
    }
  };
}

async function loadPracticeQuestion() {
  const params = new URLSearchParams();
  if (practiceFilters.section) params.set('section', practiceFilters.section);
  if (practiceFilters.domain) params.set('domain', practiceFilters.domain);
  if (practiceFilters.skill) params.set('skill', practiceFilters.skill);
  if (practiceFilters.difficulty) params.set('difficulty', practiceFilters.difficulty);
  if (practiceFilters.frequency) params.set('frequency', practiceFilters.frequency);
  const d = await api('/api/questions/next' + (params.toString()?`?${params}`:''));
  practice = d.question;
  practiceStartedAt = performance.now();
  practiceAnswered = false;
  practiceSelected = null;
  practiceHints = [];
  practiceBookmarked = false;
  lastResult = null;
  try { const marks = await api('/api/bookmarks'); practiceBookmarked = marks.some(m=>m.question_id===practice.id); } catch {}
}
async function toggleBookmark() {
  if (!practice) return;
  try {
    if (practiceBookmarked) { await api('/api/bookmarks/'+practice.id, {method:'DELETE'}); practiceBookmarked=false; }
    else { await api('/api/bookmarks', {method:'POST', body:JSON.stringify({question_id:practice.id})}); practiceBookmarked=true; }
    render();
  } catch(e) { alert(e.message); }
}

function questionMeta(q) {
  return `<div class="questionMeta"><span class="pill">${esc(q.section==='math'?'Math':'Reading & Writing')}</span>${q.domain?`<span class="pill mutedPill">${esc(q.domain)}</span>`:''}<span class="pill mutedPill">${esc(q.skill)}</span><span class="pill diff-${q.difficulty}">${esc(difficultyLabel(q.difficulty))}</span>${q.frequency_tier?`<span class="pill frequencyPill">${esc(frequencyLabel(q.frequency_tier))}</span>`:''}</div>`;
}

function renderHint(h) { return `<div class="hint"><span class="hintIcon">💡</span><div><b>Hint ${h.level}</b><div>${esc(h.text)}</div></div></div>`; }

function calculatorHtml(targetId = 'grid') {
  return `<div class="calculatorCard">
    <div class="calculatorHeader"><span>Calculator</span><button class="calcClear" type="button" data-calc-action="clear">Clear</button></div>
    <input class="calculatorDisplay" id="calcDisplay" aria-label="Calculator expression" value="" placeholder="0">
    <div class="calculatorGrid">
      <button class="calcBtn" type="button" data-calc-action="7">7</button>
      <button class="calcBtn" type="button" data-calc-action="8">8</button>
      <button class="calcBtn" type="button" data-calc-action="9">9</button>
      <button class="calcBtn calcOp" type="button" data-calc-action="/">÷</button>
      <button class="calcBtn" type="button" data-calc-action="4">4</button>
      <button class="calcBtn" type="button" data-calc-action="5">5</button>
      <button class="calcBtn" type="button" data-calc-action="6">6</button>
      <button class="calcBtn calcOp" type="button" data-calc-action="*">×</button>
      <button class="calcBtn" type="button" data-calc-action="1">1</button>
      <button class="calcBtn" type="button" data-calc-action="2">2</button>
      <button class="calcBtn" type="button" data-calc-action="3">3</button>
      <button class="calcBtn calcOp" type="button" data-calc-action="-">−</button>
      <button class="calcBtn" type="button" data-calc-action="0">0</button>
      <button class="calcBtn" type="button" data-calc-action=".">.</button>
      <button class="calcBtn" type="button" data-calc-action="del">⌫</button>
      <button class="calcBtn calcOp" type="button" data-calc-action="+">+</button>
      <button class="calcBtn" type="button" data-calc-action="(">(</button>
      <button class="calcBtn" type="button" data-calc-action=")">)</button>
      <button class="calcBtn" type="button" data-calc-action="^">xʸ</button>
      <button class="calcBtn calcOp" type="button" data-calc-action="sqrt">√</button>
      <button class="calcBtn calcEquals" type="button" data-calc-action="equals">=</button>
    </div>
    ${targetId ? `<button class="calcUse" type="button" data-calc-action="use">Use result in answer</button>` : ''}
  </div>`;
}

function evaluateCalculatorExpression(expression) {
  const tokens = expression.match(/\d*\.?\d+(?:e[+-]?\d+)?|sqrt|[()+\-*/^]/gi) || [];
  if (tokens.join('') !== expression.replace(/\s+/g, '')) throw new Error('Check the calculator expression.');
  let index = 0;
  const parsePrimary = () => {
    const token = tokens[index++];
    if (token === '+') return parsePrimary();
    if (token === '-') return -parsePrimary();
    if (token === '(') {
      const value = parseExpression();
      if (tokens[index++] !== ')') throw new Error('Missing closing parenthesis.');
      return value;
    }
    if (token && token.toLowerCase() === 'sqrt') {
      if (tokens[index++] !== '(') throw new Error('Use √ with parentheses.');
      const value = parseExpression();
      if (tokens[index++] !== ')') throw new Error('Missing closing parenthesis.');
      if (value < 0) throw new Error('Cannot take the square root of a negative number.');
      return Math.sqrt(value);
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error('Check the calculator expression.');
    return value;
  };
  const parsePower = () => {
    const left = parsePrimary();
    return tokens[index] === '^' ? (index++, Math.pow(left, parsePower())) : left;
  };
  const parseProduct = () => {
    let value = parsePower();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++];
      const right = parsePower();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const parseExpression = () => {
    let value = parseProduct();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++];
      const right = parseProduct();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const result = parseExpression();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Check the calculator expression.');
  return Number(result.toPrecision(12)).toString();
}

function wireCalculator(targetId = 'grid') {
  const display = document.getElementById('calcDisplay');
  if (!display) return;
  document.querySelectorAll('[data-calc-action]').forEach((button) => {
    button.onclick = () => {
      const target = document.getElementById(targetId);
      const action = button.dataset.calcAction;
      const current = display.value;
      if (action === 'clear') {
        display.value = '';
        return;
      }
      if (action === 'equals') {
        try { display.value = evaluateCalculatorExpression(current); }
        catch (error) { alert(error.message); }
        return;
      }
      if (action === 'use') {
        if (target) {
          target.value = display.value;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }
      if (action === 'del') {
        display.value = current.slice(0, -1);
        return;
      }
      display.value = action === 'sqrt' ? `${current}sqrt(` : `${current}${action}`;
    };
  });
  display.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      try { display.value = evaluateCalculatorExpression(display.value); }
      catch (error) { alert(error.message); }
    }
  };
}

async function practiceView() {
  if (!practice) {
    try { await loadPracticeQuestion(); } catch(e) { return `<div class="card"><div class="error">${esc(e.message)}</div></div>`; }
  }
  const q = practice;
  const disabled = practiceAnswered ? 'disabled' : '';
  const choices = q.choices ? q.choices.map((c,i)=>{
    const letter = String.fromCharCode(65+i);
    let state='';
    if(practiceAnswered && lastResult){
      if(letter===lastResult.correctAnswer) state=' correctChoice';
      else if(letter===practiceSelected && !lastResult.isCorrect) state=' wrongChoice';
    } else if(practiceSelected===letter) state=' selectedChoice';
    return `<button class="choice${state}" ${disabled} data-a="${letter}"><span class="choiceLetter">${letter}</span><span>${esc(c)}</span>${practiceAnswered&&letter===lastResult.correctAnswer?'<span class="choiceMark">✓</span>':''}</button>`;
  }).join('') : `<div class="gridAnswer"><input id="grid" class="input bigInput" value="${esc(practiceSelected||'')}" ${disabled} placeholder="Enter your answer"><div class="small muted">You can use fractions, decimals, or equivalent math expressions.</div></div>`;
  const calculator = q.section === 'math' ? calculatorHtml(q.choices ? '' : 'grid') : '';
  const feedback = lastResult ? `<div class="answerPanel ${lastResult.isCorrect?'answerGood':'answerBad'}">
      <div class="answerHeader"><div><div class="eyebrow">ANSWER RESULT</div><h2>${lastResult.isCorrect?'Correct — great work!':'Not quite — learn from this one.'}</h2></div><div class="resultIcon">${lastResult.isCorrect?'✓':'!'}</div></div>
      <div class="resultGrid">
        <div><span>Your answer</span><b>${esc(lastResult.studentAnswer || '—')}</b></div>
        <div><span>Correct answer</span><b>${esc(lastResult.correctAnswer)}</b></div>
        <div><span>Time</span><b>${Math.round(lastResult.timeSeconds||0)}s</b></div>
        <div><span>Hints used</span><b>${lastResult.hintsUsed||0}</b></div>
      </div>
      <div class="explanation"><h4>Step-by-step explanation</h4><p>${esc(lastResult.explanation)}</p></div>
      ${lastResult.learningPoint?`<div class="learningPoint"><b>What to remember</b><p>${esc(lastResult.learningPoint)}</p></div>`:''}
      ${lastResult.mastery?`<div class="masteryUpdate"><span>Skill mastery after this attempt</span><strong>${Math.round(lastResult.mastery.newAbility)}</strong><span>${lastResult.mastery.newAttempts} attempt${lastResult.mastery.newAttempts===1?'':'s'}</span></div>`:''}
    </div>` : '';
  return `<div class="pageHead practiceHead"><div><div class="eyebrow">ADAPTIVE PRACTICE</div><h1>Practice question</h1><p class="muted">One question at a time. Your answers shape what you see next.</p></div><button class="btn alt" id="changeFilters">Change topic</button></div>
    <div class="practiceProgress"><div><b>Current question</b><span id="practiceTimer">00:00</span></div><div class="timerBar"><i id="timerBarFill"></i></div><span class="muted">Session adapts after every answer</span></div>
    <div class="practiceLayout"><div class="card questionCard">
      ${questionMeta(q)}
      <div class="questionNumber">Question</div>
      <div class="qTitle">${esc(q.stem)}</div>
      ${choices}
      ${calculator}
      <div class="practiceActions"><button class="btn alt" id="bookmarkBtn">${practiceBookmarked?'♥ Bookmarked':'♡ Bookmark'}</button><button class="btn alt" id="hintBtn" ${practiceAnswered?'disabled':''}>💡 Hint ${practiceHints.length?`(${practiceHints.length}/3)`:''}</button>${!practiceAnswered?`<button class="btn btnPrimary" id="submitBtn">Submit answer</button>`:'<button class="btn btnPrimary" id="next">Next question →</button>'}</div>
      <button class="btn alt reportQuestionBtn" data-report-question="${esc(q.id)}">Report question issue</button>
      <div class="hints">${practiceHints.map(renderHint).join('')}</div>
      ${feedback}
    </div>
    <aside class="card sideQuestion"><h3>Question details</h3>${q.domain?`<div class="detail"><span>Domain</span><b>${esc(q.domain)}</b></div>`:''}<div class="detail"><span>Skill</span><b>${esc(q.skill)}</b></div><div class="detail"><span>Difficulty</span><b>${esc(difficultyLabel(q.difficulty))}</b></div><div class="detail"><span>Topic frequency</span><b>${esc(frequencyLabel(q.frequency_tier))}</b></div><div class="detail"><span>Source</span><b>${esc(q.source||'SAT-style bank')}</b></div><div class="miniTip"><b>Tip</b><p>Try the question yourself before using a hint. A little productive struggle improves retention.</p></div></aside></div>`;
}

function profileForm() {
  const s=me.student;
  layout(`<div class="pageHead"><div><div class="eyebrow">ACCOUNT</div><h1>Your profile</h1></div></div><div class="card formCard"><div class="stack"><label class="label">Name<input class="input" id="pname" value="${esc(me.user.name)}"></label><label class="label">Target SAT score<input class="input" id="score" type="number" min="400" max="1600" step="10" value="${s.target_score||''}"></label><label class="label">Test date<input class="input" id="date" type="date" value="${s.test_date||''}"></label><label class="label">Weekly available minutes<input class="input" id="mins" type="number" min="0" value="${s.weekly_available_minutes||''}"></label><button class="btn btnPrimary" id="save">Save profile</button></div></div>`);
  document.getElementById('save').onclick=async()=>{ try { await api('/api/me',{method:'PATCH',body:JSON.stringify({name:document.getElementById('pname').value.trim(),target_score:document.getElementById('score').value?Number(document.getElementById('score').value):null,test_date:document.getElementById('date').value||null,weekly_available_minutes:document.getElementById('mins').value?Number(document.getElementById('mins').value):null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})}); me=await api('/api/me'); page='dashboard'; render(); } catch(e){ alert(e.message); }};
}

function practiceFiltersView() {
  const section = practiceFilters.section;
  return `<div class="modalBackdrop" id="filterBackdrop"><div class="modal card"><div class="sectionHead"><div><div class="eyebrow">PRACTICE SETTINGS</div><h2>Choose what to practice</h2></div><button class="iconBtn" id="closeFilters">×</button></div><div class="filterGrid"><label class="label">Section<select class="input" id="fSection"><option value="">Adaptive (recommended)</option><option value="math" ${section==='math'?'selected':''}>Math</option><option value="reading_writing" ${section==='reading_writing'?'selected':''}>Reading & Writing</option></select></label><label class="label">Domain<select class="input" id="fDomain"><option value="">All domains</option></select></label><label class="label">Skill<select class="input" id="fSkill"><option value="">All skills</option></select></label><label class="label">Difficulty<select class="input" id="fDifficulty"><option value="">Any difficulty</option>${[1,2,3,4,5].map(d=>`<option value="${d}" ${String(practiceFilters.difficulty)===String(d)?'selected':''}>${difficultyLabel(d)}</option>`).join('')}</select></label><label class="label">Topic frequency<select class="input" id="fFrequency"><option value="">Any frequency</option>${['very_common','common','moderate','less_common'].map(f=>`<option value="${f}" ${practiceFilters.frequency===f?'selected':''}>${frequencyLabel(f)}</option>`).join('')}</select></label></div><div class="modalActions"><button class="btn alt" id="clearFilters">Clear</button><button class="btn btnPrimary" id="applyFilters">Apply & get question</button></div></div></div>`;
}

async function showPracticeFilters() {
  const layer = document.createElement('div'); layer.innerHTML = practiceFiltersView(); document.body.appendChild(layer.firstElementChild);
  const sec=document.getElementById('fSection'), dom=document.getElementById('fDomain'), skill=document.getElementById('fSkill');
  const meta=await api('/api/question-filters');
  const fill=()=>{const s=sec.value; const domains=meta.domains.filter(x=>!s||x.section===s); dom.innerHTML='<option value="">All domains</option>'+domains.map(x=>`<option value="${esc(x.domain)}">${esc(x.domain)}</option>`).join(''); if(practiceFilters.domain)dom.value=practiceFilters.domain; const skills=meta.skills.filter(x=>(!s||x.section===s)&&(!dom.value||x.domain===dom.value)); skill.innerHTML='<option value="">All skills</option>'+skills.map(x=>`<option value="${esc(x.skill)}">${esc(x.skill)}</option>`).join(''); if(practiceFilters.skill)skill.value=practiceFilters.skill;};
  sec.onchange=fill; dom.onchange=fill; fill();
  document.getElementById('closeFilters').onclick=()=>document.getElementById('filterBackdrop').remove();
  document.getElementById('clearFilters').onclick=()=>{practiceFilters={section:'',domain:'',skill:'',difficulty:'',frequency:''};document.getElementById('filterBackdrop').remove();practice=null;render();};
  document.getElementById('applyFilters').onclick=()=>{practiceFilters={section:sec.value,domain:dom.value,skill:skill.value,difficulty:document.getElementById('fDifficulty').value,frequency:document.getElementById('fFrequency').value};document.getElementById('filterBackdrop').remove();practice=null;lastResult=null;render();};
}

async function tutorView(){const sessions=await api('/api/chat/sessions');return `<div class="pageHead"><div><div class="eyebrow">PERSONAL TUTOR</div><h1>AI Tutor</h1><p class="muted">Ask for hints, explanations, strategy, or help understanding a mistake.</p></div></div>${practice?`<div class="learningPoint"><b>Context shared with the tutor</b><p>Your current practice question (${esc(practice.skill)}) is available if you ask about "this question."</p></div>`:''}<div class="card chat"><div class="messages" id="messages">${chatSession?(chatSession.messages||[]).map(m=>`<div class="msg ${m.role}"><div class="msgRole">${m.role==='user'?'You':'Tutor'}</div>${esc(m.content)}</div>`).join(''):'<div class="chatEmpty"><div class="chatIcon">✦</div><h3>What are you working on?</h3><p class="muted">Try “Explain why I got my last question wrong” or “Give me a hint without giving the answer.”</p></div>'}</div><div class="composer"><input id="chatInput" class="input" placeholder="Ask your tutor something..."><button class="btn btnPrimary" id="send">Send</button></div></div><div class="card" style="margin-top:16px"><div class="sectionHead"><h3>Previous sessions</h3>${chatSession?'<button class="linkBtn" id="newChat">New session</button>':''}</div><div class="sessionList">${sessions.map(s=>`<button class="sessionBtn ${chatSession?.session?.id===s.id?'selected':''}" data-session="${s.id}"><span>${esc(s.title)}</span><small>${new Date(s.updated_at).toLocaleString()}</small></button>`).join('')||'<span class="muted">No saved sessions yet.</span>'}</div></div>`;}

function attemptTrendMarkup(recent = []) {
  const attempts = [...recent].reverse();
  if (!attempts.length) {
    return `<section class="attemptTrend" aria-labelledby="attemptTrendTitle">
      <div class="sectionHead"><div><h3 id="attemptTrendTitle">Recent practice</h3><span class="muted">Outcome of your latest recorded questions</span></div></div>
      <div class="attemptTrendEmpty">Your attempt chart will appear here after you answer practice questions.</div>
    </section>`;
  }
  const left = 124;
  const right = 758;
  const points = attempts.map((attempt, index) => {
    const x = attempts.length === 1 ? (left + right) / 2 : left + index * ((right - left) / (attempts.length - 1));
    const y = attempt.is_correct ? 51 : 132;
    const outcome = attempt.is_correct ? 'Correct' : 'Incorrect';
    const when = new Date(attempt.created_at).toLocaleString();
    return `<g><line class="trendStem" x1="${x}" y1="91" x2="${x}" y2="${y}"></line><circle class="trendPoint ${attempt.is_correct ? 'correct' : 'incorrect'}" cx="${x}" cy="${y}" r="7"><title>Attempt ${index + 1}: ${outcome} · ${esc(attempt.skill)} · ${esc(when)}</title></circle></g>`;
  }).join('');
  return `<section class="attemptTrend" aria-labelledby="attemptTrendTitle">
    <div class="sectionHead"><div><h3 id="attemptTrendTitle">Recent practice</h3><span class="muted">Outcome of your latest ${attempts.length} recorded question${attempts.length === 1 ? '' : 's'}</span></div><span class="pill">${attempts.length} shown</span></div>
    <div class="trendLegend"><span><i class="trendDot"></i>Correct</span><span><i class="trendDot missed"></i>Incorrect</span></div>
    <svg class="trendSvg" viewBox="0 0 780 190" role="img" aria-label="Outcomes of the ${attempts.length} most recent practice attempts, from earlier to most recent">
      <line class="trendGuide" x1="116" y1="51" x2="768" y2="51"></line>
      <line class="trendGuide" x1="116" y1="132" x2="768" y2="132"></line>
      <text x="8" y="55">Correct</text><text x="8" y="136">Incorrect</text>
      ${points}
      <text x="116" y="177">Earlier</text><text x="710" y="177">Most recent</text>
    </svg>
  </section>`;
}

async function progressView() {
  const p = await api('/api/progress');
  const masteryRows = p.mastery.map(m => {
    const masteryPercent = Math.max(0, Math.min(100, Number(m.ability || 0) / 10));
    return `<tr>
      <td><b>${esc(m.skill)}</b></td>
      <td><div class="masteryCell"><span class="abilityBadge">${Math.round(m.ability)}</span><div class="masteryMeter" role="img" aria-label="Estimated mastery ${Math.round(masteryPercent)}%"><span style="width:${masteryPercent}%"></span></div></div></td>
      <td>${m.attempts ? Math.round(m.correct / m.attempts * 100) : 0}%</td>
      <td>${m.attempts}</td>
      <td>${Math.round(m.avg_time_seconds || 0)}s</td>
      <td>${m.sr_due_at ? new Date(m.sr_due_at).toLocaleDateString() : '-'}</td>
    </tr>`;
  }).join('');
  const reviewRows = p.due.map(x => `<div class="reviewRow"><div><b>${esc(x.skill)}</b><span class="muted">Due ${new Date(x.sr_due_at).toLocaleDateString()}</span></div><span>${Math.round(x.ability)}</span></div>`).join('');
  const recentRows = p.recent.map(a => `<div class="attemptRow"><span class="attemptDot ${a.is_correct ? 'good' : 'bad'}">${a.is_correct ? '✓' : '×'}</span><div><b>${esc(a.skill)}</b><span class="muted">${new Date(a.created_at).toLocaleString()}</span></div><strong>${a.is_correct ? 'Correct' : 'Incorrect'}</strong></div>`).join('');
  return `<div class="pageHead"><div><div class="eyebrow">PERFORMANCE</div><h1>Your progress</h1><p class="muted">See how your skill mastery changes as you practice.</p></div><button class="btn btnPrimary" id="progressPractice">Practice weakest skill</button></div>
    <div class="grid">
      <div class="card"><div class="muted">Questions answered</div><div class="stat">${p.stats.attempts || 0}</div></div>
      <div class="card"><div class="muted">Accuracy</div><div class="stat">${pct(p.stats.accuracy)}</div></div>
      <div class="card"><div class="muted">Average time</div><div class="stat">${Math.round(p.stats.avg_time || 0)}s</div></div>
    </div>
    ${attemptTrendMarkup(p.recent)}
    <div class="card" style="margin-top:16px">
      <div class="sectionHead"><h3>Skill mastery</h3><span class="muted">Higher ability = stronger estimated mastery</span></div>
      <div class="tableWrap"><table class="table"><thead><tr><th>Skill</th><th>Ability</th><th>Accuracy</th><th>Attempts</th><th>Avg time</th><th>Next review</th></tr></thead><tbody>${masteryRows || '<tr><td colspan="6" class="muted">No mastery data yet.</td></tr>'}</tbody></table></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h3>Review queue</h3>${reviewRows || '<p class="muted">Nothing is due right now.</p>'}</div>
      <div class="card"><h3>Recent attempts</h3>${recentRows || '<p class="muted">No attempts yet.</p>'}</div>
    </div>`;
}

function questionForm(initial={}) { const q=initial; return `<div class="modalBackdrop" id="qModal"><div class="modal card wideModal"><div class="sectionHead"><div><div class="eyebrow">QUESTION BANK</div><h2>${q.id?'Edit question':'Create question'}</h2></div><button class="iconBtn" id="closeQ">×</button></div><div class="formGrid"><label class="label">Section<select class="input" id="qSection"><option value="math" ${q.section==='math'?'selected':''}>Math</option><option value="reading_writing" ${q.section==='reading_writing'?'selected':''}>Reading & Writing</option></select></label><label class="label">Domain<input class="input" id="qDomain" value="${esc(q.domain||'')}"></label><label class="label">Skill<input class="input" id="qSkill" value="${esc(q.skill||'')}"></label><label class="label">Difficulty<select class="input" id="qDifficulty">${[1,2,3,4,5].map(d=>`<option value="${d}" ${Number(q.difficulty||3)===d?'selected':''}>${difficultyLabel(d)}</option>`).join('')}</select></label><label class="label">Frequency<select class="input" id="qFrequency">${['very_common','common','moderate','less_common','unknown'].map(f=>`<option value="${f}" ${q.frequency_tier===f?'selected':''}>${frequencyLabel(f)}</option>`).join('')}</select></label><label class="label">Previous exam occurrences<input class="input" id="qOcc" type="number" min="0" value="${q.previous_exam_occurrence_count??''}"></label></div><label class="label">Question<textarea class="input textArea" id="qStem" rows="5">${esc(q.stem||'')}</textarea></label><label class="label">Choices (one per line, leave empty for grid-in)<textarea class="input textArea" id="qChoices" rows="5">${esc((q.choices||[]).join('\n'))}</textarea></label><div class="formGrid"><label class="label">Correct answer<input class="input" id="qAnswer" value="${esc(q.correct_answer||'')}"></label><label class="label">Source<input class="input" id="qSource" value="${esc(q.source||'admin')}"></label></div><label class="label">Explanation<textarea class="input textArea" id="qExplanation" rows="6">${esc(q.explanation||'')}</textarea></label><div class="modalActions"><button class="btn alt" id="closeQ2">Cancel</button><button class="btn btnPrimary" id="saveQ">${q.id?'Save changes':'Create question'}</button></div></div></div>`; }

async function adminView(){const stats=await api('/api/admin/stats'); return `<div class="pageHead"><div><div class="eyebrow">ADMIN CONSOLE</div><h1>Manage your SAT Tutor</h1><p class="muted">Users, questions, quality, and product health in one place.</p></div><div class="adminActions"><button class="btn alt" id="newQuestion">+ New question</button><button class="btn btnPrimary" id="refreshAdmin">Refresh</button></div></div><div class="grid adminStats"><div class="card"><div class="muted">Students</div><div class="stat">${stats.users}</div></div><div class="card"><div class="muted">7-day active</div><div class="stat">${stats.weeklyActive}</div></div><div class="card"><div class="muted">Approved questions</div><div class="stat">${stats.questions}</div></div><div class="card"><div class="muted">Pending review</div><div class="stat">${stats.pendingQuestions}</div></div><div class="card"><div class="muted">Open feedback</div><div class="stat">${stats.pendingFeedback}</div></div><div class="card"><div class="muted">Tests completed</div><div class="stat">${stats.testsCompleted}</div></div></div><div class="adminTabs"><button class="tab active" data-admin-tab="questions">Question bank</button><button class="tab" data-admin-tab="users">Users</button><button class="tab" data-admin-tab="feedback">Feedback</button><button class="tab" data-admin-tab="analytics">Analytics</button></div><div id="adminPanel"></div>`;}

function adminTabAction(tab){
  if(tab==='questions') return adminQuestions();
  if(tab==='users') return adminUsers();
  if(tab==='feedback') return adminFeedback();
  if(tab==='analytics') return adminAnalytics();
}

function openQuestionReport(questionId){
  const layer=document.createElement('div');
  layer.innerHTML=`<div class="modalBackdrop" id="questionReportModal"><div class="modal card"><div class="sectionHead"><div><div class="eyebrow">QUESTION QUALITY</div><h2>Report an issue</h2></div><button class="iconBtn" id="closeQuestionReport">×</button></div><label class="label">Issue type<select class="input" id="questionIssueType"><option value="wording">Question wording or formatting</option><option value="options">Answer options</option><option value="answer">Correct answer</option><option value="explanation">Explanation</option><option value="other">Other</option></select></label><label class="label">What needs attention?<textarea class="input textArea" id="questionIssueDetails" rows="4" placeholder="Describe the problem you noticed"></textarea></label><div class="modalActions"><button class="btn alt" id="cancelQuestionReport">Cancel</button><button class="btn btnPrimary" id="sendQuestionReport">Send report</button></div></div></div>`;
  document.body.appendChild(layer.firstElementChild);
  const close=()=>document.getElementById('questionReportModal')?.remove();
  document.getElementById('closeQuestionReport').onclick=close;
  document.getElementById('cancelQuestionReport').onclick=close;
  document.getElementById('sendQuestionReport').onclick=async()=>{
    const type=document.getElementById('questionIssueType').value;
    const details=document.getElementById('questionIssueDetails').value.trim();
    if(!details){alert('Please describe the issue.');return;}
    try{
      await api('/api/feedback',{method:'POST',body:JSON.stringify({type:'content',question_id:questionId,message:`Question issue (${type}): ${details}`})});
      close();
      alert('Report sent. An admin can review and edit this question.');
    }catch(error){alert(error.message);}
  };
}

async function adminFeedback(){
  const items = await api('/api/admin/feedback');
  document.getElementById('adminPanel').innerHTML = `<div class="card"><div class="sectionHead"><h3>Student feedback &amp; reports</h3><span class="muted">${items.length} items</span></div>${items.map(f=>`<div class="reviewRow" style="align-items:flex-start"><div><b>${esc(f.user_name)}</b> <span class="pill mutedPill">${esc(f.type)}</span><p class="muted" style="margin:6px 0">${esc(f.message)}</p>${f.question_stem?`<p class="small muted">On: ${esc(f.question_stem.slice(0,100))}</p>`:''}<span class="small muted">${new Date(f.created_at).toLocaleString()}</span></div><div class="feedbackActions">${f.question_id?`<button class="btn alt" data-edit-feedback-question="${esc(f.question_id)}">Edit question</button>`:''}<select class="input" data-feedback-status="${f.id}" style="width:auto"><option value="open" ${f.status==='open'?'selected':''}>Open</option><option value="in_review" ${f.status==='in_review'?'selected':''}>In review</option><option value="resolved" ${f.status==='resolved'?'selected':''}>Resolved</option><option value="dismissed" ${f.status==='dismissed'?'selected':''}>Dismissed</option></select></div></div>`).join('')||'<div class="emptyState">No feedback submitted yet.</div>'}</div>`;
  document.querySelectorAll('[data-feedback-status]').forEach(sel=>sel.onchange=async()=>{await api('/api/admin/feedback/'+sel.dataset.feedbackStatus,{method:'PATCH',body:JSON.stringify({status:sel.value})});});
  document.querySelectorAll('[data-edit-feedback-question]').forEach(button=>button.onclick=async()=>{try{const question=await api('/api/admin/questions/'+button.dataset.editFeedbackQuestion);await openQuestionModal(question);}catch(error){alert(error.message);}});
}

async function adminAnalytics(){
  const a = await api('/api/admin/analytics');
  document.getElementById('adminPanel').innerHTML = `<div class="grid2">
    <div class="card"><div class="sectionHead"><h3>Lowest-accuracy skills</h3><span class="muted">Possible content quality issues</span></div>${a.skillAccuracy.map(s=>`<div class="reviewRow"><div><b>${esc(s.skill)}</b><span class="muted">${s.attempts} attempts</span></div><span>${s.accuracy}%</span></div>`).join('')||'<p class="muted">Not enough data yet.</p>'}</div>
    <div class="card"><div class="sectionHead"><h3>Difficulty calibration</h3><span class="muted">Accuracy should generally fall as difficulty rises</span></div>${a.difficultyCalibration.map(d=>`<div class="reviewRow"><div><b>${difficultyLabel(d.difficulty)}</b><span class="muted">${d.attempts} attempts</span></div><span>${d.accuracy}%</span></div>`).join('')||'<p class="muted">Not enough data yet.</p>'}</div>
  </div>
  <div class="card" style="margin-top:16px"><div class="sectionHead"><h3>Most-missed questions (≥5 attempts)</h3></div>${a.mostMissed.map(q=>`<div class="reviewRow"><div><b>${esc(q.stem.slice(0,80))}</b><span class="muted">${esc(q.skill)} · ${q.attempts} attempts</span></div><span>${q.accuracy}%</span></div>`).join('')||'<p class="muted">Not enough data yet.</p>'}</div>`;
}

async function adminQuestions(){const qs=await api('/api/admin/questions?'+new URLSearchParams(adminQuestionFilters));const meta=await api('/api/question-filters');document.getElementById('adminPanel').innerHTML=`<div class="card"><div class="filterBar"><input class="input" id="aqSearch" placeholder="Search question text, skill, ID..." value="${esc(adminQuestionFilters.search)}"><select class="input" id="aqSection"><option value="">All sections</option><option value="math" ${adminQuestionFilters.section==='math'?'selected':''}>Math</option><option value="reading_writing" ${adminQuestionFilters.section==='reading_writing'?'selected':''}>Reading & Writing</option></select><select class="input" id="aqDomain"><option value="">All domains</option>${meta.domains.map(x=>`<option value="${esc(x.domain)}" ${adminQuestionFilters.domain===x.domain?'selected':''}>${esc(x.domain)}</option>`).join('')}</select><select class="input" id="aqDifficulty"><option value="">All difficulty</option>${[1,2,3,4,5].map(d=>`<option value="${d}" ${String(adminQuestionFilters.difficulty)===String(d)?'selected':''}>${difficultyLabel(d)}</option>`).join('')}</select><select class="input" id="aqStatus"><option value="">All status</option>${['approved','draft','human_review','rejected','archived'].map(s=>`<option value="${s}" ${adminQuestionFilters.status===s?'selected':''}>${s}</option>`).join('')}</select><button class="btn btnPrimary" id="aqApply">Filter</button></div><div class="questionCount"><b>${qs.total}</b> questions found</div><div class="questionList">${qs.items.map(q=>`<article class="questionRow"><div class="questionRowMain"><div class="questionMeta"><span class="pill">${q.section==='math'?'Math':'Reading & Writing'}</span><span class="pill mutedPill">${esc(q.domain||'')}</span><span class="pill diff-${q.difficulty}">${difficultyLabel(q.difficulty)}</span><span class="pill ${q.status==='approved'?'approvedPill':'statusPill'}">${esc(q.status)}</span></div><h3>${esc(q.stem)}</h3><p class="muted">${esc(q.skill)} · ${frequencyLabel(q.frequency_tier)} · Previous-exam occurrences: ${q.previous_exam_occurrence_count??'Not verified'}</p></div><div class="questionRowActions"><button class="btn alt" data-edit-q="${q.id}">Edit</button>${q.status!=='approved'?`<button class="btn btnPrimary" data-approve-q="${q.id}">Approve</button>`:'<button class="btn danger" data-archive-q="'+q.id+'">Archive</button>'}</div></article>`).join('')||'<div class="emptyState">No questions match these filters.</div>'}</div></div>`;
  document.getElementById('aqApply').onclick=()=>{adminQuestionFilters={search:document.getElementById('aqSearch').value.trim(),section:document.getElementById('aqSection').value,domain:document.getElementById('aqDomain').value,skill:'',difficulty:document.getElementById('aqDifficulty').value,frequency:'',status:document.getElementById('aqStatus').value};adminQuestions();};
  document.querySelectorAll('[data-edit-q]').forEach(b=>b.onclick=async()=>{const q=await api('/api/admin/questions/'+b.dataset.editQ);openQuestionModal(q);});
  document.querySelectorAll('[data-approve-q]').forEach(b=>b.onclick=async()=>{await api('/api/admin/questions/'+b.dataset.approveQ,{method:'PATCH',body:JSON.stringify({status:'approved',validated:1})});adminQuestions();});
  document.querySelectorAll('[data-archive-q]').forEach(b=>b.onclick=async()=>{if(confirm('Archive this question?')){await api('/api/admin/questions/'+b.dataset.archiveQ,{method:'PATCH',body:JSON.stringify({status:'archived',validated:0})});adminQuestions();}});
}

async function adminUsers(){const users=await api('/api/admin/users');document.getElementById('adminPanel').innerHTML=`<div class="card"><div class="sectionHead"><h3>Students</h3><span class="muted">${users.length} accounts</span></div><div class="tableWrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Attempts</th><th>Target</th><th>Test date</th></tr></thead><tbody>${users.map(u=>`<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td><span class="pill ${u.status==='active'?'approvedPill':'statusPill'}">${esc(u.status)}</span></td><td>${u.attempts}</td><td>${u.target_score||'-'}</td><td>${u.test_date||'-'}</td></tr>`).join('')}</tbody></table></div></div>`;}

async function openQuestionModal(q={}){const wrap=document.createElement('div');wrap.innerHTML=questionForm(q);document.body.appendChild(wrap.firstElementChild);document.getElementById('closeQ').onclick=()=>document.getElementById('qModal').remove();document.getElementById('closeQ2').onclick=()=>document.getElementById('qModal').remove();document.getElementById('saveQ').onclick=async()=>{try{const choicesText=document.getElementById('qChoices').value.trim();const payload={section:document.getElementById('qSection').value,domain:document.getElementById('qDomain').value.trim(),skill:document.getElementById('qSkill').value.trim(),difficulty:Number(document.getElementById('qDifficulty').value),frequency_tier:document.getElementById('qFrequency').value,previous_exam_occurrence_count:document.getElementById('qOcc').value===''?null:Number(document.getElementById('qOcc').value),stem:document.getElementById('qStem').value.trim(),choices:choicesText?choicesText.split('\n').map(x=>x.trim()).filter(Boolean):null,correct_answer:document.getElementById('qAnswer').value.trim(),answer_type:choicesText?'mcq':'grid-in',source:document.getElementById('qSource').value.trim()||'admin',explanation:document.getElementById('qExplanation').value.trim(),status:'approved',validated:1};if(!payload.stem||!payload.skill||!payload.correct_answer||!payload.explanation)throw new Error('Question, skill, correct answer and explanation are required.');const endpoint=q.id?`/api/admin/questions/${q.id}`:'/api/admin/questions';await api(endpoint,{method:q.id?'PATCH':'POST',body:JSON.stringify(payload)});document.getElementById('qModal').remove();adminQuestions();}catch(e){alert(e.message);}};}

async function render(){
  if(!me) return authView('login');
  if(page==='dashboard'){
    layout(await dashboard());
    document.getElementById('start').onclick=()=>{page='practice';practice=null;render();};
    document.getElementById('progressLink').onclick=()=>{page='progress';render();};
    document.getElementById('settings').onclick=profileForm;
    const sd=document.getElementById('startDiagnostic');if(sd)sd.onclick=()=>startPracticeTest('diagnostic');
    document.querySelectorAll('[data-revoke-session]').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('Revoke this session?')) {
          await api('/api/auth/sessions/' + btn.dataset.revokeSession, { method: 'DELETE' });
          render();
        }
      };
    });
    const revokeAll = document.getElementById('revokeAllBtn');
    if (revokeAll) {
      revokeAll.onclick = async () => {
        if (confirm('Log out of all other devices?')) {
          await api('/api/auth/sessions/revoke-all', { method: 'POST' });
          render();
        }
      };
    }
    const delBtn = document.getElementById('deleteAccountBtn');
    if (delBtn) delBtn.onclick = openDeleteAccountModal;
    return;
  }
  if(page==='practice'){layout(await practiceView());
    document.getElementById('changeFilters').onclick=showPracticeFilters;
    document.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ if(practiceAnswered)return; practiceSelected=b.dataset.a; render(); });
    const g=document.getElementById('grid'); if(g){g.oninput=()=>practiceSelected=g.value;g.onkeydown=e=>{if(e.key==='Enter')submitAnswer(g.value);};}
    if(document.getElementById('calcDisplay')) wireCalculator(g ? 'grid' : '');
    const submit=document.getElementById('submitBtn');if(submit)submit.onclick=()=>submitAnswer(practiceSelected||'');
    const hint=document.getElementById('hintBtn');if(hint)hint.onclick=getHint;
    const bm=document.getElementById('bookmarkBtn');if(bm)bm.onclick=toggleBookmark;
    const next=document.getElementById('next');if(next)next.onclick=async()=>{await loadPracticeQuestion();render();};
    document.querySelectorAll('[data-report-question]').forEach(button=>button.onclick=()=>openQuestionReport(button.dataset.reportQuestion));
    startTimer();return;
  }
  if(page==='tutor'){layout(await tutorView());document.getElementById('send').onclick=sendChat;document.getElementById('chatInput').onkeydown=e=>{if(e.key==='Enter')sendChat()};document.querySelectorAll('[data-session]').forEach(b=>b.onclick=async()=>{chatSession=await api('/api/chat/sessions/'+b.dataset.session);render();});const n=document.getElementById('newChat');if(n)n.onclick=()=>{chatSession=null;render();};return;}
  if(page==='progress'){layout(await progressView());document.getElementById('progressPractice').onclick=()=>{practiceFilters={section:'',domain:'',skill:document.querySelector('.table tbody tr')?.querySelector('td')?.innerText||'',difficulty:'',frequency:''};page='practice';practice=null;render();};return;}
  if(page==='admin'){layout(await adminView());document.getElementById('newQuestion').onclick=()=>openQuestionModal();document.getElementById('refreshAdmin').onclick=render;document.querySelectorAll('[data-admin-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-admin-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');adminTabAction(b.dataset.adminTab);});await adminQuestions();return;}
  if(page==='bookmarks'){layout(await bookmarksView());document.querySelectorAll('[data-open-q]').forEach(b=>b.onclick=()=>{practiceFilters={section:'',domain:'',skill:'',difficulty:'',frequency:''};page='practice';practice=null;openSpecificQuestion(b.dataset.openQ);});document.querySelectorAll('[data-unbookmark]').forEach(b=>b.onclick=async()=>{await api('/api/bookmarks/'+b.dataset.unbookmark,{method:'DELETE'});render();});return;}
  if(page==='mistakes'){layout(await mistakesView());document.querySelectorAll('[data-retry-q]').forEach(b=>b.onclick=()=>{practiceFilters={section:'',domain:'',skill:'',difficulty:'',frequency:''};page='practice';openSpecificQuestion(b.dataset.retryQ);});return;}
  if(page==='studyplan'){layout(await studyPlanView());const g=document.getElementById('generatePlan');if(g)g.onclick=async()=>{await api('/api/study-plan/generate',{method:'POST'});render();};return;}
  if(page==='achievements'){layout(await achievementsView());return;}
  if(page==='daily'){layout(await dailyChallengeView());
    document.querySelectorAll('[data-daily-choice]').forEach(b=>b.onclick=async()=>{const [qid,ans]=b.dataset.dailyChoice.split('|');await submitDailyAnswer(qid,ans);});
    document.querySelectorAll('[data-daily-submit-grid]').forEach(b=>b.onclick=async()=>{const qid=b.dataset.dailySubmitGrid;const input=document.querySelector(`[data-daily-grid="${qid}"]`);await submitDailyAnswer(qid,input?input.value:'');});
    return;
  }
  if(page==='tests'){layout(await testsHubView());document.querySelectorAll('[data-start-test]').forEach(b=>b.onclick=()=>startPracticeTest(b.dataset.startTest));return;}
  if(page==='testrun'){
    layout(await testRunView());
    wireTestRun();
    const back=document.getElementById('backToTests');
    if(back)back.onclick=()=>{currentTest=null;page='tests';render();};
    const retry=document.getElementById('retryTestExplanations');
    if(retry)retry.onclick=()=>{testExplanationRequestedId=null;testExplanationError=null;loadTestExplanations(currentTest.id);};
    document.querySelectorAll('[data-report-question]').forEach(button=>button.onclick=()=>openQuestionReport(button.dataset.reportQuestion));
    if(currentTest?.status==='finished'&&testExplanationRequestedId!==currentTest.id)loadTestExplanations(currentTest.id);
    return;
  }
}

async function submitDailyAnswer(questionId,answer){
  if(!answer){ alert('Select an answer or enter a value first.'); return; }
  try { await api('/api/daily-challenge/answer',{method:'POST',body:JSON.stringify({question_id:questionId,student_answer:answer,time_seconds:15})}); render(); }
  catch(e){ alert(e.message); }
}

async function openSpecificQuestion(questionId) {
  try {
    const q = await api('/api/questions/'+questionId);
    practice = q; practiceStartedAt = performance.now(); practiceAnswered=false; practiceSelected=null; practiceHints=[]; lastResult=null;
    try { const marks = await api('/api/bookmarks'); practiceBookmarked = marks.some(m=>m.question_id===practice.id); } catch { practiceBookmarked=false; }
    render();
  } catch(e) { alert(e.message); }
}

// --- Bookmarks -----------------------------------------------------------
async function bookmarksView(){
  const marks = await api('/api/bookmarks');
  return `<div class="pageHead"><div><div class="eyebrow">SAVED FOR LATER</div><h1>Bookmarks</h1><p class="muted">Questions you flagged to revisit.</p></div></div>
  <div class="card">${marks.map(m=>`<article class="questionRow"><div class="questionRowMain"><div class="questionMeta"><span class="pill">${m.section==='math'?'Math':'Reading & Writing'}</span><span class="pill mutedPill">${esc(m.skill)}</span><span class="pill diff-${m.difficulty}">${difficultyLabel(m.difficulty)}</span></div><h3>${esc(m.stem)}</h3>${m.note?`<p class="muted">Note: ${esc(m.note)}</p>`:''}</div><div class="questionRowActions"><button class="btn btnPrimary" data-open-q="${m.question_id}">Practice again</button><button class="btn danger" data-unbookmark="${m.question_id}">Remove</button></div></article>`).join('') || '<div class="emptyState">No bookmarks yet. Tap the bookmark button while practicing to save a question here.</div>'}</div>`;
}

// --- Mistake review --------------------------------------------------------
async function mistakesView(){
  const mistakes = await api('/api/mistakes');
  return `<div class="pageHead"><div><div class="eyebrow">LEARN FROM MISSES</div><h1>Mistake review</h1><p class="muted">Questions your most recent attempt got wrong. Once you answer one correctly it drops off this list.</p></div></div>
  <div class="card">${mistakes.map(m=>`<article class="questionRow"><div class="questionRowMain"><div class="questionMeta"><span class="pill">${m.section==='math'?'Math':'Reading & Writing'}</span><span class="pill mutedPill">${esc(m.skill)}</span><span class="pill diff-${m.difficulty}">${difficultyLabel(m.difficulty)}</span></div><h3>${esc(m.stem)}</h3><p class="muted">Your answer: ${esc(m.student_answer)} · Missed ${m.attempt_count} attempt${m.attempt_count===1?'':'s'} · ${new Date(m.created_at).toLocaleDateString()}</p></div><div class="questionRowActions"><button class="btn btnPrimary" data-retry-q="${m.question_id}">Try again</button></div></article>`).join('') || '<div class="emptyState">No open mistakes right now — nice work.</div>'}</div>`;
}

// --- Study plan --------------------------------------------------------------
async function studyPlanView(){
  const {plan} = await api('/api/study-plan');
  return `<div class="pageHead"><div><div class="eyebrow">YOUR SCHEDULE</div><h1>Study plan</h1><p class="muted">A weekly schedule built from your weak skills, spaced-repetition queue, and available time.</p></div><button class="btn btnPrimary" id="generatePlan">${plan?'Regenerate plan':'Generate plan'}</button></div>
  ${plan ? `<div class="card"><div class="grid"><div><span class="muted">Sessions / week</span><div class="stat">${plan.sessionsPerWeek}</div></div><div><span class="muted">Minutes / session</span><div class="stat">${plan.sessions[0]?.minutes||30}</div></div><div><span class="muted">Days until test</span><div class="stat">${plan.daysUntilTest??'—'}</div></div></div>${plan.note?`<div class="learningPoint" style="margin-top:16px"><p>${esc(plan.note)}</p></div>`:''}</div>
  <div class="card" style="margin-top:16px"><div class="sectionHead"><h3>This week</h3></div>${plan.sessions.map(s=>`<div class="reviewRow"><div><b>Session ${s.session}</b><span class="muted">${esc(s.activity)} · ${esc(s.focus_skill)}</span></div><span>${s.minutes} min</span></div>`).join('')}</div>`
  : '<div class="card emptyState">No plan yet — generate one to get a personalized weekly schedule.</div>'}`;
}

// --- Achievements --------------------------------------------------------------
async function achievementsView(){
  const a = await api('/api/achievements');
  return `<div class="pageHead"><div><div class="eyebrow">MOTIVATION</div><h1>Achievements &amp; streaks</h1><p class="muted">Milestones based on your real activity — nothing here is awarded manually.</p></div></div>
  <div class="grid heroGrid"><div class="card"><div class="muted">Current streak</div><div class="heroStat">${a.currentStreak}</div><div class="small muted">day${a.currentStreak===1?'':'s'} in a row</div></div><div class="card"><div class="muted">Longest streak</div><div class="stat">${a.longestStreak}</div></div><div class="card"><div class="muted">Total correct</div><div class="stat">${a.totals.correct}</div></div></div>
  <div class="grid2" style="margin-top:16px">${a.badges.map(b=>`<div class="card ${b.unlocked?'':'mutedPill'}" style="opacity:${b.unlocked?1:0.6}"><div class="sectionHead"><h3>${b.unlocked?'🏆':'🔒'} ${esc(b.name)}</h3></div><p class="muted">${esc(b.description)}</p><div class="progress"><i style="width:${Math.round(b.progress*100)}%"></i></div></div>`).join('')}</div>`;
}

// --- Daily challenge --------------------------------------------------------------
let dailyAnswers = {};
async function dailyChallengeView(){
  const d = await api('/api/daily-challenge');
  dailyAnswers = d.answered || {};
  return `<div class="pageHead"><div><div class="eyebrow">${d.date}</div><h1>Daily challenge</h1><p class="muted">The same 5 questions for everyone today. Complete all 5 to keep your streak alive.</p></div></div>
  <div class="card">${d.questions.map((q,i)=>{
    const done = dailyAnswers[q.id];
    return `<div class="card" style="margin-bottom:12px;${done?'opacity:0.75':''}"><div class="questionMeta"><span class="pill">${q.section==='math'?'Math':'Reading & Writing'}</span><span class="pill diff-${q.difficulty}">${difficultyLabel(q.difficulty)}</span>${done?`<span class="pill ${done.isCorrect?'approvedPill':'statusPill'}">${done.isCorrect?'Correct':'Incorrect'}</span>`:''}</div>
    <p class="qTitle" style="font-size:16px">${esc(q.stem)}</p>
    ${done ? '' : (q.choices ? q.choices.map((c,ci)=>`<button class="choice" data-daily-choice="${q.id}|${String.fromCharCode(65+ci)}"><span class="choiceLetter">${String.fromCharCode(65+ci)}</span><span>${esc(c)}</span></button>`).join('') : `<div class="gridAnswer"><input class="input bigInput" data-daily-grid="${q.id}" placeholder="Enter your answer"><button class="btn btnPrimary" data-daily-submit-grid="${q.id}" style="margin-top:8px">Submit</button></div>`)}
    </div>`;
  }).join('')}</div>`;
}

// --- Practice tests (diagnostic / full-length / section) -------------------------------
async function testsHubView(){
  const history = await api('/api/practice-tests');
  return `<div class="pageHead"><div><div class="eyebrow">TIMED PRACTICE</div><h1>Practice tests</h1><p class="muted">Realistic, timed SAT-style sets with a scaled score estimate at the end.</p></div></div>
  <div class="grid">
    <div class="card"><h3>Diagnostic</h3><p class="muted">24 questions across every domain. 35 minutes total.</p><button class="btn btnPrimary" data-start-test="diagnostic">Start</button></div>
    <div class="card"><h3>Full-length</h3><p class="muted">Reading &amp; Writing + Math, 98 questions. 134 minutes across four timed modules.</p><button class="btn btnPrimary" data-start-test="full">Start</button></div>
    <div class="card"><h3>Math only</h3><p class="muted">44 Math questions. Two 35-minute modules with calculator access.</p><button class="btn btnPrimary" data-start-test="math">Start</button></div>
    <div class="card"><h3>Reading &amp; Writing only</h3><p class="muted">54 Reading &amp; Writing questions across two 32-minute modules.</p><button class="btn btnPrimary" data-start-test="reading_writing">Start</button></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="sectionHead"><h3>History</h3></div><div class="tableWrap"><table class="table"><thead><tr><th>Mode</th><th>Status</th><th>Score</th><th>Date</th></tr></thead><tbody>${history.map(t=>`<tr><td>${esc(t.mode)}</td><td>${esc(t.status)}</td><td>${t.score?(t.score.composite||Object.values(t.score.byModule)[0].scaled):'—'}</td><td>${new Date(t.startedAt).toLocaleDateString()}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No tests taken yet.</td></tr>'}</tbody></table></div></div>`;
}

let currentTest = null;
let testItemIndex = 0;
let testItemStartedAt = null;
let selectedTestAnswer = null;
let advancingExpiredModule = false;
let testExplanationRequestedId = null;
let testExplanationError = null;
let testClockAnchor = null;

function syncTestClock(test) {
  testClockAnchor = {
    serverTime: new Date(test.serverNow || Date.now()).getTime(),
    monotonicTime: performance.now(),
  };
}

function getServerClockNow() {
  if (!testClockAnchor) return Date.now();
  return testClockAnchor.serverTime + (performance.now() - testClockAnchor.monotonicTime);
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getTestTotalMs() {
  if (!currentTest || !currentTest.config || !currentTest.config.modules) return 0;
  return currentTest.config.modules.reduce((sum, mod) => sum + (Number(mod.minutes) || 0) * 60 * 1000, 0);
}

function getCurrentTestModuleIndex() {
  const item = currentTest?.items?.[testItemIndex];
  return item ? currentTest.config.modules.findIndex(module => module.module === item.module) : -1;
}

function getTestModuleRemainingMs(moduleIndex = getCurrentTestModuleIndex()) {
  if (!currentTest || currentTest.status !== 'in_progress' || !currentTest.startedAt || moduleIndex < 0) return 0;
  const elapsed = getServerClockNow() - new Date(currentTest.startedAt).getTime();
  const elapsedBeforeModule = currentTest.config.modules.slice(0, moduleIndex).reduce((sum, module) => sum + (Number(module.minutes) || 0) * 60 * 1000, 0);
  const moduleDuration = (Number(currentTest.config.modules[moduleIndex].minutes) || 0) * 60 * 1000;
  return Math.max(0, moduleDuration - Math.max(0, elapsed - elapsedBeforeModule));
}

function getTestModuleName(module) {
  const section = module?.section;
  if (section === 'math') return 'Math';
  if (section === 'reading_writing') return 'Reading & Writing';
  return 'Diagnostic';
}

async function advanceExpiredModule() {
  if (advancingExpiredModule) return;
  advancingExpiredModule = true;
  const expiredModule = currentTest.items[testItemIndex]?.module;
  while (testItemIndex < currentTest.items.length && currentTest.items[testItemIndex].module === expiredModule) testItemIndex++;
  selectedTestAnswer = null;
  if (testItemIndex >= currentTest.items.length) await finishTest();
  else {
    testItemStartedAt = performance.now();
    await render();
  }
  advancingExpiredModule = false;
}

function startTestTimer() {
  clearInterval(testTimerInterval);
  if (!document.getElementById('testTimer') || !currentTest || currentTest.status !== 'in_progress') return;
  const update = () => {
    const el = document.getElementById('testTimer');
    const fill = document.getElementById('testTimerBar');
    if (!el || !currentTest || currentTest.status !== 'in_progress') return;
    const moduleIndex = getCurrentTestModuleIndex();
    const moduleDuration = (Number(currentTest.config.modules[moduleIndex]?.minutes) || 0) * 60 * 1000;
    const remainingMs = getTestModuleRemainingMs(moduleIndex);
    el.textContent = formatClock(remainingMs);
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, (remainingMs / moduleDuration) * 100 || 0))}%`;
    if (remainingMs <= 0) {
      clearInterval(testTimerInterval);
      advanceExpiredModule();
    }
  };
  update();
  testTimerInterval = setInterval(update, 1000);
}

async function startPracticeTest(mode){
  try { currentTest = await api('/api/practice-test/start', {method:'POST', body:JSON.stringify({mode})}); syncTestClock(currentTest); testItemIndex=0; testItemStartedAt=performance.now(); selectedTestAnswer=null; testExplanationRequestedId=null; testExplanationError=null; page='testrun'; render(); }
  catch(e){ alert(e.message); }
}
async function testRunView(){
  if(!currentTest) { page='tests'; return await testsHubView(); }
  if(currentTest.status!=='in_progress') return testResultView();
  const item = currentTest.items[testItemIndex];
  if(!item) return `<div class="card"><p>All questions answered.</p><button class="btn btnPrimary" id="finishTestBtn">Finish &amp; see score</button></div>`;
  const moduleIndex = getCurrentTestModuleIndex();
  const currentModule = currentTest.config.modules[moduleIndex];
  const calculator = item.section === 'math' ? calculatorHtml(item.choices ? '' : 'testGrid') : '';
  const sameSectionModules = currentTest.config.modules.filter(module => module.section === currentModule.section);
  const sectionModuleNumber = sameSectionModules.findIndex(module => module.module === currentModule.module) + 1;
  const sectionModuleCount = sameSectionModules.length;
  const moduleItems = currentTest.items.filter(testItem => testItem.module === item.module);
  const moduleQuestionNumber = moduleItems.findIndex(testItem => testItem.question_id === item.question_id) + 1;
  return `<div class="pageHead practiceHead"><div><div class="eyebrow">MODULE QUESTION ${moduleQuestionNumber} OF ${moduleItems.length} · OVERALL ${testItemIndex+1} OF ${currentTest.items.length} · MODULE ${moduleIndex+1} OF ${currentTest.config.modules.length}</div><h1>${getTestModuleName(currentModule)}</h1></div><div class="testClock"><span>Module time remaining</span><strong id="testTimer">${formatClock(getTestModuleRemainingMs(moduleIndex))}</strong></div></div>
  <div class="card questionCard"><div class="practiceProgress" style="margin-bottom:14px"><div><b>${getTestModuleName(currentModule)} · Module ${sectionModuleNumber} of ${sectionModuleCount}</b><span>${moduleQuestionNumber} of ${moduleItems.length} questions · ${currentModule.minutes} minutes</span></div><div class="timerBar"><i id="testTimerBar"></i></div></div>
  ${questionMeta(item)}<div class="qTitle">${esc(item.stem)}</div>
  ${item.choices ? item.choices.map((c,i)=>{const letter=String.fromCharCode(65+i);return `<button class="choice${selectedTestAnswer===letter?' selectedChoice':''}" data-test-choice="${letter}"><span class="choiceLetter">${letter}</span><span>${esc(c)}</span></button>`;}).join('') : `<div class="gridAnswer"><input id="testGrid" class="input bigInput" placeholder="Enter your answer"></div>`}
  ${calculator}
  <div class="practiceActions"><button class="btn alt" id="testSkip">Skip question</button><button class="btn alt reportQuestionBtn" data-report-question="${esc(item.question_id)}">Report question issue</button><button class="btn btnPrimary" id="testSubmit">${testItemIndex===currentTest.items.length-1?'Submit & finish':'Submit & next'}</button></div>
  </div>`;
}
function wireTestRun(){
  document.querySelectorAll('[data-test-choice]').forEach(b=>b.onclick=()=>{selectedTestAnswer=b.dataset.testChoice;render();});
  const submit=document.getElementById('testSubmit'); if(submit) submit.onclick=()=>{const g=document.getElementById('testGrid'); submitTestAnswer(g?g.value:selectedTestAnswer||'');};
  const skip=document.getElementById('testSkip'); if(skip) skip.onclick=skipTestQuestion;
  const finish=document.getElementById('finishTestBtn'); if(finish) finish.onclick=finishTest;
  if (document.getElementById('calcDisplay')) wireCalculator(document.getElementById('testGrid') ? 'testGrid' : '');
  startTestTimer();
}
async function submitTestAnswer(answer){
  if(!answer){ alert('Select an answer or enter a value first.'); return; }
  const item = currentTest.items[testItemIndex];
  const elapsed = Math.max(1,(performance.now()-testItemStartedAt)/1000);
  try {
    await api(`/api/practice-test/${currentTest.id}/answer`, {method:'POST', body:JSON.stringify({question_id:item.question_id, student_answer:answer, time_seconds:elapsed})});
    testItemIndex++; testItemStartedAt=performance.now();
    selectedTestAnswer=null;
    if(testItemIndex>=currentTest.items.length) { await finishTest(); return; }
    render();
  } catch(e){ alert(e.message); }
}
async function skipTestQuestion(){
  if(!currentTest||currentTest.status!=='in_progress')return;
  testItemIndex++;
  selectedTestAnswer=null;
  testItemStartedAt=performance.now();
  if(testItemIndex>=currentTest.items.length){await finishTest();return;}
  render();
}
async function finishTest(){
  try { currentTest = await api(`/api/practice-test/${currentTest.id}/finish`, {method:'POST'}); render(); } catch(e){ alert(e.message); }
}
function testResultView(){
  const s = currentTest.score || {byModule:{}};
  const sectionNames = {math:'Math',reading_writing:'Reading & Writing',diagnostic:'Diagnostic',mixed:'Diagnostic'};
  const answerLabel = (item, answer) => {
    if (!item.choices) return answer || 'No answer';
    const index = String(answer || '').toUpperCase().charCodeAt(0) - 65;
    return index >= 0 && index < item.choices.length ? `${String.fromCharCode(65+index)}. ${item.choices[index]}` : answer || 'No answer';
  };
  return `<div class="pageHead"><div><div class="eyebrow">RESULTS</div><h1>Test complete</h1></div></div>
  <div class="grid heroGrid">${Object.entries(s.byModule).map(([mod,v])=>`<div class="card"><div class="muted">${sectionNames[mod]||esc(mod)} score estimate</div><div class="heroStat">${v.scaled}</div><div class="small muted">${v.correct}/${v.total} correct</div></div>`).join('')}${s.composite?`<div class="card"><div class="muted">Composite estimate</div><div class="heroStat">${s.composite}</div><div class="small muted">Not an official SAT score</div></div>`:''}</div>
  ${testExplanationError?`<div class="error explanationError">Could not prepare answer explanations: ${esc(testExplanationError)} <button class="btn alt" id="retryTestExplanations">Retry</button></div>`:`<p class="muted explanationStatus">${testExplanationRequestedId===currentTest.id?'Preparing question-specific answer explanations…':'Answer explanations are generated from each question and its answer key.'}</p>`}
  <details class="card testReview"><summary>Review answers and explanations</summary>${currentTest.items.map((item,index)=>`<article class="testReviewItem"><div class="questionMeta"><span class="pill">Question ${index+1}</span><span class="pill mutedPill">${getTestModuleName({section:item.section})}</span><span class="pill ${item.is_correct?'approvedPill':'statusPill'}">${item.is_correct?'Correct':item.student_answer==null?'Unanswered':'Incorrect'}</span></div><p class="testReviewStem">${esc(item.stem)}</p><div class="testReviewAnswers"><div><span>Your answer</span><b>${esc(answerLabel(item,item.student_answer))}</b></div><div><span>Correct answer</span><b>${esc(answerLabel(item,item.correct_answer))}</b></div></div><p class="testReviewExplanation">${esc(item.explanation||'Preparing a question-specific explanation…')}</p></article>`).join('')}</details>
  <div class="card" style="margin-top:16px"><button class="btn btnPrimary" id="backToTests">Back to practice tests</button></div>`;
}

async function loadTestExplanations(testId){
  testExplanationRequestedId=testId;
  testExplanationError=null;
  try {
    const result=await api(`/api/practice-test/${testId}/explanations`,{method:'POST'});
    if(currentTest?.id!==testId)return;
    for(const item of currentTest.items) item.explanation=result.explanations?.[item.question_id]||item.explanation;
    render();
  } catch(error) {
    if(currentTest?.id!==testId)return;
    testExplanationError=error.message;
    render();
  }
}

function needsGeneratedExplanation(text){
  return !text||/source answer key:|does not include a question-level explanation|generating question-specific/i.test(text);
}

async function getHint(){try{if(practiceAnswered||practiceHints.length>=3)return;const r=await api('/api/practice/hint',{method:'POST',body:JSON.stringify({question_id:practice.id,level:practiceHints.length+1})});practiceHints.push(r.hint);render();}catch(e){alert(e.message)}}
async function submitAnswer(answer){if(practiceAnswered)return;if(!answer||!String(answer).trim()){alert('Select an answer or enter a value first.');return;}try{const elapsed=Math.max(1,(performance.now()-practiceStartedAt)/1000);const r=await api('/api/practice/answer',{method:'POST',body:JSON.stringify({question_id:practice.id,student_answer:String(answer),time_seconds:elapsed,hints_used:practiceHints.length})});r.timeSeconds=elapsed;r.hintsUsed=practiceHints.length;const needsExplanation=needsGeneratedExplanation(r.explanation);if(needsExplanation)r.explanation='Generating question-specific explanation…';lastResult=r;practiceAnswered=true;render();if(needsExplanation){try{const generated=await api('/api/question-explanation',{method:'POST',body:JSON.stringify({question_id:practice.id,student_answer:String(answer)})});if(lastResult!==r)return;r.explanation=generated.explanation;render();}catch(error){if(lastResult!==r)return;r.explanation=`Could not generate an explanation right now. ${error.message}`;render();}}}catch(e){alert(e.message)}}
function startTimer(){const el=document.getElementById('practiceTimer'),fill=document.getElementById('timerBarFill');clearInterval(window.__timer);if(!el||!practiceStartedAt)return;const update=()=>{const sec=Math.floor((performance.now()-practiceStartedAt)/1000);el.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;if(fill)fill.style.width=`${Math.min(100,(sec/120)*100)}%`;};update();if(!practiceAnswered)window.__timer=setInterval(update,1000);}
async function sendChat(){const inp=document.getElementById('chatInput');const text=inp.value.trim();if(!text)return;inp.value='';try{const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message:text,session_id:chatSession?.session?.id||null,current_question_id:practice?practice.id:null})});chatSession=await api('/api/chat/sessions/'+r.session_id);render();}catch(e){alert(e.message)}}
async function boot(){
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get('token');
  const resetToken = searchParams.get('resetToken');

  if (resetToken) {
    window.history.replaceState({}, document.title, window.location.pathname);
    me = null;
    resetPasswordView(resetToken);
    return;
  }

  if (token) {
    try {
      const res = await api('/api/auth/verify-email?token=' + encodeURIComponent(token));
      window.history.replaceState({}, document.title, window.location.pathname);
      me = null;
      authView('login', '', res.message || 'Email verified successfully! You can now log in.');
      return;
    } catch(e) {
      window.history.replaceState({}, document.title, window.location.pathname);
      me = null;
      authView('login', e.message);
      return;
    }
  }
  try {
    me = await api('/api/me');
    render();
  } catch {
    me = null;
    authView('login');
  }
}
boot();
