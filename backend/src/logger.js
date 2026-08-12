function write(severity, message, meta = {}) {
  console.log(JSON.stringify({ severity, message, ...meta, timestamp: new Date().toISOString() }))
}

const logger = {
  info(message, meta) {
    write('INFO', message, meta)
  },
  warn(message, meta) {
    write('WARNING', message, meta)
  },
  error(message, meta) {
    write('ERROR', message, meta)
  },
}

module.exports = logger
