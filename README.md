# Vercel Proxy Server

Vercel 앱에서 RDS에 접근하기 위한 프록시 서버입니다.

## 기능

- Vercel 앱의 정적 파일들을 프록시
- API 요청은 직접 처리하여 RDS에 연결
- 고정 IP를 통한 RDS 접근

## 환경 변수

- `DB_HOST`: RDS 호스트
- `DB_USER`: RDS 사용자명
- `DB_PASSWORD`: RDS 비밀번호
- `DB_NAME`: RDS 데이터베이스명
- `DB_PORT`: RDS 포트 (기본: 3306)
- `JWT_SECRET`: JWT 시크릿 키
- `VERCEL_URL`: Vercel 앱 URL

## 배포

1. Railway에 프로젝트 연결
2. 환경 변수 설정
3. 자동 배포 완료

## 엔드포인트

- `GET /health`: 헬스 체크
- `GET /db-test`: DB 연결 테스트
- `POST /api/auth/login`: 로그인
- `POST /api/auth/logout`: 로그아웃
- `GET /api/auth/me`: 사용자 정보
- `GET /api/universities`: 대학교 목록
- `GET /api/data/lectures`: 강의 목록
- `GET /api/data/stats`: 통계
- `GET /api/data/lecture-stats`: 강의별 통계
