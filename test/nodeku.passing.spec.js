const Test = require('tape')
let Nodeku = require('../')
const Mocks = require('./mocks')

Nodeku = Nodeku.bind({ MockSSDPClient: Mocks.Client });

function wrapper(description, fn) {
  Test(description, t => {
    Nodeku()
    .then(device => {
      fn(t, device)
    })
    .catch(t.fail)
  })
}

Test('initialization', t => {
  t.ok(typeof Nodeku === 'function', 'is ready')
  t.end()
})

wrapper('methods: .ip()', (t, device) => {
  t.ok(device.hasOwnProperty('ip'), 'exists')
  t.ok(typeof device.ip === 'function' , 'is a function')
  t.assert(device.ip() === '192.168.1.17:8060', 'ip address retreived')
  t.end()
})

wrapper('discovery', (t, device) => {
  t.timeoutAfter(2000)

  t.assert(typeof device === 'object', 'module received')
  t.assert(device.ip() === '192.168.1.17:8060', 'ip address located')

  t.end()
})