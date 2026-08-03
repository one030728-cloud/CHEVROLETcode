import { posPluginSdk } from '@tossplace/pos-plugin-sdk'

// 실제 토스POS 단말기 밖(로컬 브라우저)에서 미리 볼 때는 posPluginSdk가 부모 프레임(POS 앱)과
// 통신하지 못해 응답이 오지 않는다. localhost/onrender.com 미리보기에서는 테스트 매장(merchantId '0')을
// 그대로 흉내 낸 값을 써서, 실제 단말기 없이도 화면/API 연동을 확인할 수 있게 한다.
const isPreview = /^(localhost|127\.0\.0\.1|chevroletcode\.onrender\.com)$/.test(location.hostname)

const API_BASE = isPreview ? '' : 'https://chevroletcode.onrender.com'

const STATUS_LABEL = { waiting: '대기중', called: '호출완료', notify_failed: '알림실패' }

const listEl = document.getElementById('list')
const storeNameEl = document.getElementById('store-name')

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
  if (!reservations.length) {
    listEl.innerHTML = `<div class="empty"><div class="empty-title">대기중인 손님이 없습니다</div>새 예약이 들어오면 여기에 표시됩니다.</div>`
    return
  }
  listEl.innerHTML = reservations
    .map((r) => {
      const state = confirming.get(r.id)
      const callConfirming = state?.action === 'call'
      const completeConfirming = state?.action === 'complete'
      const canCall = r.status === 'waiting'
      const canComplete = r.status === 'called' || r.status === 'notify_failed'
      return `
        <div class="row">
          <div class="num">#${r.queueNumber}</div>
          <div class="info">
            <div class="car">${escapeHtml(r.carNumber)} <span class="badge ${r.status}">${STATUS_LABEL[r.status] || r.status}</span></div>
            <div class="sub">${escapeHtml(r.serviceType || '-')}</div>
          </div>
          <div class="actions">
            <button
              class="${callConfirming ? 'confirm' : ''}"
              data-id="${r.id}" data-action="call"
              ${canCall ? '' : 'disabled'}
            >${callConfirming ? '확정' : '호출'}</button>
            <button
              class="complete ${completeConfirming ? 'confirm' : ''}"
              data-id="${r.id}" data-action="complete"
              ${canComplete ? '' : 'disabled'}
            >${completeConfirming ? '확정' : '완료'}</button>
          </div>
        </div>
      `
    })
    .join('')
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]')
  if (!btn || btn.disabled) return
  handleActionClick(btn.dataset.id, btn.dataset.action)
})

async function loadQueue() {
  const { ok, body } = await apiGet(`/api/pos/queue?merchantId=${encodeURIComponent(merchantId)}`)
  if (!ok) return
  render(body.reservations || [])
}

async function main() {
  const merchant = await getMerchant()
  merchantId = merchant.id
  storeNameEl.textContent = merchant.name || ''

  await loadQueue()
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(loadQueue, 5000)
}

main()
