const CAR_NUMBER_RE = /^\d{2,3}[가-힣]\d{4}$/
const PHONE_RE = /^01[0-9]{8,9}$/

const title = document.getElementById('title')
const subtitle = document.getElementById('subtitle')
const dots = document.querySelectorAll('.dot')

const stepCar = document.getElementById('step-car')
const stepPhone = document.getElementById('step-phone')
const stepDone = document.getElementById('step-done')

const carNumberInput = document.getElementById('carNumber')
const carError = document.getElementById('carError')
const toPhoneBtn = document.getElementById('toPhoneBtn')

const phoneInput = document.getElementById('phone')
const phoneError = document.getElementById('phoneError')
const submitBtn = document.getElementById('submitBtn')
const backBtn = document.getElementById('backBtn')

function setStep(step) {
  stepCar.classList.toggle('hidden', step !== 'car')
  stepPhone.classList.toggle('hidden', step !== 'phone')
  stepDone.classList.toggle('hidden', step !== 'done')
  dots.forEach(dot => dot.classList.toggle('active', dot.dataset.step === step))
  subtitle.textContent = step === 'car' ? '차량번호를 입력해주세요' : step === 'phone' ? '전화번호를 입력해주세요' : ''
}

carNumberInput.addEventListener('input', () => {
  carError.textContent = ''
  toPhoneBtn.disabled = !CAR_NUMBER_RE.test(carNumberInput.value.trim())
})

carNumberInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !toPhoneBtn.disabled) goToPhoneStep()
})

toPhoneBtn.addEventListener('click', goToPhoneStep)

function goToPhoneStep() {
  if (!CAR_NUMBER_RE.test(carNumberInput.value.trim())) {
    carError.textContent = '차량번호 형식이 올바르지 않습니다. 예) 12가3456'
    return
  }
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
  const carNumber = carNumberInput.value.trim()
  const phone = phoneInput.value.replace(/-/g, '').trim()

  if (!PHONE_RE.test(phone)) {
    phoneError.textContent = '전화번호 형식이 올바르지 않습니다.'
    return
  }

  submitBtn.disabled = true
  submitBtn.textContent = '처리 중...'

  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carNumber, phone }),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      phoneError.textContent = json.error || '예약 접수 중 오류가 발생했습니다.'
      submitBtn.disabled = false
      submitBtn.textContent = '예약 완료'
      return
    }

    setStep('done')
  } catch (err) {
    phoneError.textContent = '네트워크 오류가 발생했습니다.'
    submitBtn.disabled = false
    submitBtn.textContent = '예약 완료'
  }
}
