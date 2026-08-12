# Backend tests

테스트는 로컬 PostgreSQL의 `devdb`만 사용합니다. Cloud SQL/운영 `DATABASE_URL`을 지정한 상태로
실행하지 마세요. 테스트 파일은 `localhost`, `127.0.0.1`, `::1`의 `devdb`가 아니면 시작 단계에서
실패하도록 되어 있습니다.

```powershell
docker run --name chevrolet-test-postgres `
  -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=devdb `
  -p 5432:5432 -d postgres:16-alpine

$env:DATABASE_URL = 'postgresql://postgres:devpass@localhost:5432/devdb?schema=public'
npx prisma migrate deploy
npm test
```

GitHub Actions에서는 동일한 PostgreSQL 서비스 컨테이너를 사용합니다. 테스트 종료 후 컨테이너가
필요 없으면 `docker rm -f chevrolet-test-postgres`로 제거하세요.
