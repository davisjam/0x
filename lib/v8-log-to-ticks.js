'use strict'

const { spawn } = require('child_process')
const { parse } = require('jsonstream2')
const { extname } = require('path')
const fs = require('fs')
const pump = require('pump')

module.exports = v8LogToTicks

function v8LogToTicks (isolateLogPath) {
  const isJson = extname(isolateLogPath) === '.json'
  const sp = isJson || spawn(process.argv[0], [
    '--prof-process', '--preprocess', '-j', isolateLogPath
  ], {stdio: ['ignore', 'pipe', 'inherit']})
  const close = isJson ? () => {} : () => sp.kill()
  const srcStream = isJson ? fs.createReadStream(isolateLogPath) : sp.stdout

  return new Promise((resolve, reject) => {
    const ticks = []
    const codes = []

    const codeStream = parse('code.*', (code) => {
      codes.push(code)
    })

    if (isJson === false) {
      const v8Json = isolateLogPath.replace(extname(isolateLogPath), '.json')
      pump(srcStream, fs.createWriteStream(v8Json), (err) => {
        if (err) {
          reject(err)
          close()
        }
      })
    }

    pump(srcStream, codeStream, (err) => {
      if (!err) return
      if (/^Unexpected/.test(err.message)) {
        reject(Error(codeStream._transformState.writechunk + '' || err.message))
      } else {
        reject(err)
      }
      close()
    })

    const tickStream = parse('ticks.*', (tick) => {
      const addr = tick.s.filter((n, i) => i % 2 === 0)
      var stack = addr.map((n) => codes[n]).filter(Boolean)
      ticks.push(stack.reverse())
    })

    pump(srcStream, tickStream, (err) => {
      if (err) {
        close()
        return reject(err)
      }
      resolve(ticks.filter(Boolean))
    })

    if (isJson === false) {
      sp.on('exit', (code) => {
        if (code !== 0) return reject(Error('v8 log conversion failed'))
      })
    }
  })
}
