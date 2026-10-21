
const { io } = require('socket.io-client')
const s = io('http://127.0.0.1:3001', { timeout: 10000, reconnection: false })
const call = (ev, ...args) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout ' + ev)), 15000)
  s.emit(ev, ...args, (r) => { clearTimeout(t); res(r) })
})
s.on('connect', async () => {
  const login = await call('login', { username: 'admin', password: '' })
  if (!login.ok) { console.log('login failed', login); process.exit(1) }
  const r = await call('getMonitor', 27)
  const m = r.monitor
  console.log('active=', JSON.stringify(m.active), 'interval=', m.interval, 'timeout=', m.timeout)
  console.log('accepted_statuscodes=', JSON.stringify(m.accepted_statuscodes), 'conditions=', JSON.stringify(m.conditions))
  console.log('policyJson=', JSON.stringify(m.policyJson), typeof m.policyJson)
  console.log('showMsg=', JSON.stringify(m.showMsg), 'retryInterval=', m.retryInterval, 'maxretries=', m.maxretries)
  console.log('keys count=', Object.keys(m).length)
  console.log('has sensitive sshPrivateKey=', 'sshPrivateKey' in m)
  s.close(); process.exit(0)
})
s.on('connect_error', (e) => { console.log('connect_error', e.message); process.exit(1) })
