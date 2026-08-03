import { posPluginSdk } from '@tossplace/pos-plugin-sdk'

// 실제 토스POS 단말기 밖(로컬 브라우저)에서 미리 볼 때는 posPluginSdk가 부모 프레임(POS 앱)과
// 통신하지 못해 응답이 오지 않는다. localhost/onrender.com 미리보기에서는 테스트 매장(merchantId '0')을
// 그대로 흉내 낸 값을 써서, 실제 단말기 없이도 화면/API 연동을 확인할 수 있게 한다.
const isPreview = /^(localhost|127\.0\.0\.1|chevroletcode\.onrender\.com)$/.test(location.hostname)

const API_BASE = isPreview ? '' : 'https://chevroletcode.onrender.com'

const STATUS_LABEL = { waiting: '대기중', called: '호출완료', notify_failed: '알림실패' }

const listEl = document.getElementById('list')
const storeNameEl = document.getElementById('store-name')
const waitingCountEl = document.getElementById('waiting-count')
const nextNumberEl = document.getElementById('next-number')
const lastUpdatedEl = document.getElementById('last-updated')
const connectionDotEl = document.getElementById('connection-dot')
const refreshButtonEl = document.getElementById('refresh-button')
const pageStatusEl = document.getElementById('page-status')

let merchantId = null
let pollTimer = null
// 행마다 "몇 초 안에 다시 누르면 확정" 확인 상태를 들고 있는다. 번호를 탭하는 것만으로는
// 절대 호출/완료가 나가면 안 되고, 반드시 버튼을 두 번(확인 상태 진입 -> 확정) 눌러야 한다.
const confirming = new Map() // reservationId -> { action: 'call' | 'complete', timeoutId }

async function getMerchant() {
  if (isPreview) {
    return { id: 0, name: '쉐보레 대리점 (테스트)', businessNumber: '0000000000' }
  }
  return posPluginSdk.merchant.getMerchant()
}

function notify(kind, message) {
  // 실제 단말기에서는 posPluginSdk.toast로 POS 네이티브 토스트를 띄우고,
  // 로컬 미리보기에서는 toast API가 응답하지 않으므로 alert로 대신한다.
  if (!isPreview && posPluginSdk?.toast?.[kind]) {
    posPluginSdk.toast[kind]({ message })
  } else {
    alert(message)
  }
  pageStatusEl.textContent = message
}

function setConnection(state) {
  connectionDotEl.className = `connection-dot ${state === 'online' ? '' : state}`.trim()
  connectionDotEl.title = state === 'online' ? '서버 연결됨' : state === 'checking' ? '서버 확인 중' : '서버 연결 오류'
}

function updateSummary(reservations) {
  const waiting = reservations.filter((reservation) => reservation.status === 'waiting')
  waitingCountEl.textContent = String(waiting.length)
  nextNumberEl.textContent = waiting.length ? `#${waiting[0].queueNumber}` : '—'
}

function updateLastUpdated() {
  const time = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date())
  lastUpdatedEl.textContent = `${time} 기준 · 5초마다 자동 업데이트`
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`)
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok && body.ok, body }
}

async function apiPost(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantId }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok && body.ok, body }
}

function clearConfirm(id) {
  const state = confirming.get(id)
  if (state) clearTimeout(state.timeoutId)
  confirming.delete(id)
}

// 버튼을 처음 누르면 "정말 호출/완료할까요?"로 바뀌고, 3초 안에 같은 버튼을 한 번 더 눌러야
// 실제로 서버에 요청이 나간다. 그 사이 다른 곳을 누르거나 3초가 지나면 원래 상태로 되돌아간다.
// 이렇게 하면 "대기번호 1번을 실수로 탭"하는 정도로는 절대 알림톡이 나가지 않는다.
function handleActionClick(id, action) {
  const existing = confirming.get(id)
  if (existing && existing.action === action) {
    clearConfirm(id)
    runAction(id, action)
    return
  }
  confirming.forEach((_, otherId) => clearConfirm(otherId))
  const timeoutId = setTimeout(() => {
    confirming.delete(id)
    render(lastReservations)
  }, 3000)
  confirming.set(id, { action, timeoutId })
  render(lastReservations)
}

async function runAction(id, action) {
  const path = action === 'call' ? `/api/pos/queue/${id}/call` : `/api/pos/queue/${id}/complete`
  const { ok, body } = await apiPost(path)
  if (!ok) {
    notify('error', body.error || '처리 중 오류가 발생했습니다.')
  } else {
    notify('success', action === 'call' ? '순서 호출 알림톡을 보냈습니다.' : '정비완료로 처리했습니다.')
  }
  await loadQueue()
}

let lastReservations = []

function render(reservations) {
  lastReservations = reservations
  updateSummary(reservations)
  updateLastUpdated()
  pageStatusEl.textContent = `대기열 ${reservations.length}건을 불러왔습니다.`

  const activeIds = new Set(reservations.map((reservation) => reservation.id))
  confirming.forEach((_, id) => {
    if (!activeIds.has(id)) clearConfirm(id)
  })

  if (!reservations.length) {
    listEl.innerHTML = `
      <div class="empty">
        <div class="empty-mark" aria-hidden="true">✓</div>
        <div class="empty-title">대기중인 손님이 없습니다</div>
        <div class="empty-copy">새 예약이 들어오면 이곳에 표시됩니다.</div>
      </div>
    `
    return
  }
  listEl.innerHTML = reservations
    .map((r) => {
      const state = confirming.get(r.id)
      const callConfirming = state?.action === 'call'
      const completeConfirming = state?.action === 'complete'
      const canCall = r.status === 'waiting'
      const canComplete = r.status === 'called' || r.status === 'notify_failed'
      const statusClass = ['waiting', 'called', 'notify_failed'].includes(r.status) ? r.status : 'waiting'
      const statusLabel = STATUS_LABEL[r.status] || r.status
      return `
        <article class="queue-item status-${statusClass}">
          <div class="queue-number">#${r.queueNumber}</div>
          <div class="queue-main">
            <div class="queue-top">
              <strong class="car-number">${escapeHtml(r.carNumber)}</strong>
              <span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="service">${escapeHtml(r.serviceType || '-')}</div>
          </div>
          <div class="actions">
            <button
              class="action-button ${callConfirming ? 'confirm' : ''}"
              data-id="${escapeHtml(r.id)}" data-action="call"
              aria-label="${callConfirming ? '호출 확정' : '호출'} ${escapeHtml(r.carNumber)}"
              ${canCall ? '' : 'disabled'}
            >${callConfirming ? '호출 확정' : '호출'}</button>
            <button
              class="action-button complete ${completeConfirming ? 'confirm' : ''}"
              data-id="${escapeHtml(r.id)}" data-action="complete"
              aria-label="${completeConfirming ? '완료 확정' : '완료'} ${escapeHtml(r.carNumber)}"
              ${canComplete ? '' : 'disabled'}
            >${completeConfirming ? '완료 확정' : '완료'}</button>
          </div>
        </article>
      `
    })
    .join('')
}

function renderError(message) {
  listEl.innerHTML = `
    <div class="error-card">
      <div class="error-mark" aria-hidden="true">!</div>
      <div class="error-title">대기열을 불러오지 못했습니다</div>
      <div class="error-copy">${escapeHtml(message)}</div>
    </div>
  `
  updateSummary([])
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]')
  if (!btn || btn.disabled) return
  handleActionClick(btn.dataset.id, btn.dataset.action)
})

async function loadQueue({ manual = false } = {}) {
  if (manual || !lastReservations.length) setConnection('checking')
  try {
    const { ok, body } = await apiGet(`/api/pos/queue?merchantId=${encodeURIComponent(merchantId)}`)
    if (!ok) {
      setConnection('error')
      if (!lastReservations.length) renderError(body.error || '서버에서 대기열을 확인할 수 없습니다.')
      return false
    }
    setConnection('online')
    render(body.reservations || [])
    return true
  } catch {
    setConnection('error')
    if (!lastReservations.length) renderError('네트워크 연결을 확인한 뒤 다시 시도해주세요.')
    return false
  }
}

refreshButtonEl.addEventListener('click', async () => {
  refreshButtonEl.disabled = true
  try {
    await loadQueue({ manual: true })
  } finally {
    refreshButtonEl.disabled = false
  }
})

async function main() {
  try {
    const merchant = await getMerchant()
    if (!merchant?.id && merchant?.id !== 0) throw new Error('매장 정보를 확인할 수 없습니다.')
    merchantId = merchant.id
    storeNameEl.textContent = merchant.name || '연결된 매장'

    await loadQueue()
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(loadQueue, 5000)
  } catch (error) {
    setConnection('error')
    renderError(error.message || '매장 정보를 확인할 수 없습니다.')
  }
}

main()
