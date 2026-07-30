// Design Ref: docs/02-design/features/multi-store-support.design.md Phase 3
// 비밀번호 해시/검증 + JWT 발급/검증. 2계층 관리자(role: hq_admin/store_admin) 인증용.

const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const JWT_EXPIRES_IN = '12h'

function hashPassword(password) {
  return bcrypt.hash(password, 10)
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

// Plan SC: FR-07 — role/storeId를 토큰 클레임에 담아, 매 요청마다 DB 조회 없이도
// store_admin의 접근 범위를 서버가 강제할 수 있게 한다.
function signAdminToken(adminUser) {
  const secret = process.env.JWT_SECRET
  return jwt.sign(
    { sub: adminUser.id, role: adminUser.role, storeId: adminUser.storeId || null, email: adminUser.email },
    secret,
    { expiresIn: JWT_EXPIRES_IN }
  )
}

function verifyAdminToken(token) {
  const secret = process.env.JWT_SECRET
  return jwt.verify(token, secret)
}

module.exports = { hashPassword, verifyPassword, signAdminToken, verifyAdminToken }
