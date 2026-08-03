# Chevrolet Toss Plugin TODO

상세한 배경과 실행 방법은 [`docs/gcp-migration-and-scale-plan.md`](docs/gcp-migration-and-scale-plan.md)를 참고한다.

## P0 — 현재 운영 확인

- [ ] Render 환경변수(`DATABASE_URL`, `JWT_SECRET`, 관리자 계정, Solapi 키) 확인
- [ ] 실제 토스 Front의 `merchant.id`를 Render 관리자 화면에 매장으로 등록
- [ ] 새 예약이 `waiting` 상태로 생성되는지 확인
- [ ] POS에서 호출 2단계 탭 후 `called` 및 알림톡 1회 동작 확인
- [ ] POS에서 완료 2단계 탭 후 대기열에서 제거되는지 확인
- [ ] Front/POS 개발자센터 ZIP을 최신 커밋 기준으로 다시 생성·업로드

## P1 — GCP 이전 준비

- [ ] GCP 프로젝트·리전·도메인 결정
- [ ] Cloud SQL PostgreSQL 생성 및 백업 정책 설정
- [ ] Prisma provider를 SQLite에서 PostgreSQL로 전환
- [ ] 운영 PostgreSQL migration 생성·검증
- [ ] Render SQLite 데이터 export/import
- [ ] Cloud Run 저장소 루트 배포 설정 작성
- [ ] Cloud Run Build/Start 명령과 `PORT` 동작 확인
- [ ] Secret Manager로 운영 비밀값 이전
- [ ] Front/POS API base URL을 환경별 설정으로 분리
- [ ] GCP API 도메인을 Toss Front/POS ACL에 등록

## P1 — 트래픽·중복 처리 보완

- [ ] 예약 생성의 idempotency key와 중복 예약 방지 추가
- [ ] `waiting → called` 조건부 update로 중복 호출 방지
- [ ] `called → completed` 조건부 update 추가
- [ ] 웹훅 중복 처리와 재시도 정책 점검
- [ ] `node-cron`을 Cloud Scheduler 또는 Cloud Run Job으로 분리
- [ ] 프로모션 작업의 중복 실행 방지 추가
- [ ] 인스턴스 간 공유 rate limit 검토(Redis/Cloud Armor/API Gateway)
- [ ] 알림톡 발송 지연·실패 시 재처리 정책 확정
- [ ] Cloud Run 동시성·최대 인스턴스·DB 커넥션 풀 결정

## P2 — 검증 및 전환

- [ ] 두 매장 동시 예약 시 데이터가 섞이지 않는지 확인
- [ ] 동시 예약에서 대기번호 중복이 없는지 부하 테스트
- [ ] 동시 호출에서 알림 중복이 없는지 부하 테스트
- [ ] Cloud SQL 커넥션 한도와 p95 응답시간 측정
- [ ] Cloud Scheduler 재시도 시 프로모션 중복 발송 확인
- [ ] Cloud Logging·오류 알림·백업 복구 테스트
- [ ] Toss Front/POS 개발 트랙에서 GCP API 통합 검증
- [ ] 운영 ACL과 API 주소를 GCP로 전환
- [ ] Render 롤백 유지 기간과 폐기 시점 결정

## 완료 기준

- [ ] 운영 DB가 PostgreSQL이며 재배포 후 데이터가 유지됨
- [ ] 실제 Front 예약과 POS 호출/완료가 같은 DB에서 동작함
- [ ] 예약·호출·웹훅·프로모션 중복 처리가 검증됨
- [ ] 부하 테스트 결과와 Cloud Run/DB 설정값이 기록됨
- [ ] GCP 장애 시 Render 또는 이전 ZIP으로 롤백 가능함

