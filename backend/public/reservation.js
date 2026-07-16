const CAR_NUMBER_RE = /^\d{2,3}[가-힣]\d{4}$/
const PHONE_RE = /^01[0-9]{8,9}$/

const mode = new URLSearchParams(location.search).get('mode') === 'payment' ? 'payment' : 'reservation'

const title = document.getElementById('title')
const subtitle = document.getElementById('subtitle')
const dots = document.querySelectorAll('.dot')

const stepCar = document.getElementById('step-car')
const stepPhone = document.getElementById('step-phone')
const stepDone = document.getElementById('step-done')

const carNumberInput = document.getElementById('carNumber')
const carError = document.getElementById('carError')
const toPhoneBtn = document.getElementById('toPhoneBtn')
const skipCarBtn = document.getElementById('skipCarBtn')

const phoneInput = document.getElementById('phone')
const amountWrap = document.getElementById('amountWrap')
const amountInput = document.getElementById('amount')
const phoneError = document.getElementById('phoneError')
const submitBtn = document.getElementById('submitBtn')
const submitBtnLabel = submitBtn.querySelector('.btn-label')
const submitBtnSpinner = submitBtn.querySelector('.spinner')
const backBtn = document.getElementById('backBtn')

const doneTitle = document.getElementById('doneTitle')
const doneMessage = document.getElementById('doneMessage')

let carNumber = ''
const submitLabel = mode === 'payment' ? '영수증 받기' : '예약 완료'

if (mode === 'payment') {
  title.textContent = '결제 확인'
  amountWrap.classList.remove('hidden')
  skipCarBtn.classList.remove('hidden')
  submitBtnLabel.textContent = submitLabel
}

function setStep(step) {
  stepCar.classList.toggle('hidden', step !== 'car')
  stepPhone.classList.toggle('hidden', step !== 'phone')
  stepDone.classList.toggle('hidden', step !== 'done')
  dots.forEach(dot => dot.classList.toggle('active', dot.dataset.step === step))
  if (step === 'car') subtitle.textContent = '차량번호를 입력해주세요'
  else if (step === 'phone') subtitle.textContent = mode === 'payment' ? '전자영수증을 받으실 전화번호를 입력해주세요' : '전화번호를 입력해주세요'
  else subtitle.textContent = ''
}

function setSubmitting(isSubmitting) {
  submitBtn.disabled = isSubmitting
  submitBtnLabel.classList.toggle('hidden', isSubmitting)
  submitBtnSpinner.classList.toggle('hidden', !isSubmitting)
}

carNumberInput.addEventListener('input', () => {
  carError.textContent = ''
  toPhoneBtn.disabled = !CAR_NUMBER_RE.test(carNumberInput.value.trim())
})

carNumberInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !toPhoneBtn.disabled) goToPhoneStep(carNumberInput.value.trim())
})

toPhoneBtn.addEventListener('click', () => goToPhoneStep(carNumberInput.value.trim()))

skipCarBtn.addEventListener('click', () => goToPhoneStep(''))

function goToPhoneStep(value) {
  if (value && !CAR_NUMBER_RE.test(value)) {
    carError.textContent = '차량번호 형식이 올바르지 않습니다. 예) 12가3456'
    return
  }
  if (mode === 'reservation' && !value) {
    carError.textContent = '차량번호 형식이 올바르지 않습니다. 예) 12가3456'
    return
  }
  carNumber = value
  setStep('phone')
  phoneInput.focus()
}

phoneInput.addEventListener('input', () => {
  phoneError.textContent = ''
  submitBtn.disabled = !PHONE_RE.test(phoneInput.value.replace(/-/g, '').trim())
})

phoneInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !submitBtn.disabled) submitReservation()
})

backBtn.addEventListener('click', () => {
  phoneError.textContent = ''
  setStep('car')
})

submitBtn.addEventListener('click', submitReservation)

async function submitReservation() {
  const phone = phoneInput.value.replace(/-/g, '').trim()
  const amount = amountInput.value.trim()

  if (!PHONE_RE.test(phone)) {
    phoneError.textContent = '전화번호 형식이 올바르지 않습니다.'
    return
  }

  setSubmitting(true)

  try {
    const endpoint = mode === 'payment' ? '/api/payments' : '/api/reservations'
    const body = mode === 'payment'
      ? { carNumber, phone, amount: amount || undefined }
      : { carNumber, phone }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      phoneError.textContent = json.error || '처리 중 오류가 발생했습니다.'
      setSubmitting(false)
      return
    }

    if (mode === 'payment') {
      doneTitle.textContent = '전자영수증이 발송되었습니다'
      doneMessage.textContent = '알림톡을 확인해주세요.'
    } else {
      doneTitle.textContent = '예약이 접수되었습니다'
      doneMessage.textContent = `대기번호 ${json.queueNumber}번. 순서가 되면 알림톡으로 안내드려요.`
    }
    setStep('done')
  } catch (err) {
    phoneError.textContent = '네트워크 오류가 발생했습니다.'
    setSubmitting(false)
  }
}
