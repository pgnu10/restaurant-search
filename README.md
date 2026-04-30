# restaurant-search

카카오맵 기반 음식점 메뉴/가격 비교 웹앱 + CLI.

위치와 메뉴 키워드를 입력하면 주변 음식점을 검색하고, 메뉴/가격을 지도와 함께 비교합니다.

## 설치

```bash
npm install
```

## 설정

`.env` 파일에 아래 환경변수를 설정합니다.

```
KAKAO_REST_API_KEY=your_kakao_api_key
SUPABASE_PROJECT_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_key
```

- 카카오 API 키: [Kakao Developers](https://developers.kakao.com/)에서 발급
- Supabase: [supabase.com](https://supabase.com)에서 프로젝트 생성 (무료 플랜 가능)

Supabase가 없어도 동작하지만, 캐싱과 검색 로깅이 비활성화됩니다.

## 웹앱 실행

```bash
npm start
# http://localhost:3000
```

브라우저에서 위치 + 메뉴 키워드를 입력하면:
- 주변 음식점 검색 + 메뉴/가격 수집
- 가격순 순위 + Leaflet 지도 마커 표시
- IQR 기반 이상치 가격 필터링
- 근처 지하철역 표시

## CLI 사용법

```bash
# CSV 출력
node search.js 사당역 보쌈

# HTML 리포트 생성
node search.js 강남역 피자 --html

# CSV 파일로 저장
node search.js 홍대 떡볶이 > result.csv
```

## 주요 기능

### 검색 품질
- **지역 별칭 해석**: `가디` → `가산디지털단지역`, `홍대` → `홍대입구역` 등
- **유의어 확장 매칭**: `햄버거` 검색 시 `버거` 포함 메뉴도 매칭
- **Zero-result fallback**: 결과 없을 시 반경 2km → 5km로 자동 확장
- **프랜차이즈 fallback**: 메뉴 데이터 없는 맥도날드/버거킹/KFC 등에 기본 가격 제공

### 캐싱 (Supabase)
- **메뉴 캐시**: place_id 단위, stale-while-revalidate (3일 fresh / 14일 stale)
- **검색 결과 캐시**: query + location 단위, 1일 TTL

### UX / 디자인
- **Korean Food Editorial 디자인**: 따뜻한 크림/아이보리 배경 + 한식 레드(#D93B2B) 액센트 컬러
- **타이포그래피**: Gowun Batang(제목) + Noto Sans KR(본문) + DM Mono(가격/숫자)
- **SSE Progress UI**: 음식점 검색 → 메뉴 수집 (n/total) → 결과 정렬 단계별 표시 (Vercel 환경에서는 자동 fallback 애니메이션)
- **지도 재검색**: 지도 이동 후 "이 지역에서 재검색" 버튼
- **공유 버튼**: 검색 결과 URL을 카카오톡 등으로 공유 (Web Share API → 클립보드 복사 fallback)
- **검색 실패 가이드**: 결과 없을 시 범위 확대, 지역명/메뉴명 변경 등 안내 표시
- **모바일 반응형**: 목록/지도 탭 전환
- **IQR 가격 필터**: 이상치 가격 자동 제외 + 수동 조정
- **마이크로 인터랙션**: 카드 등장 애니메이션, 호버 리프트, 포커스 글로우 등

### 데이터
- **검색 로그**: 모든 검색을 Supabase `search_logs`에 기록 (query, 결과 수, 소요시간)
- **가격 출처**: 요기요 연동 메뉴(정확) 우선, 카카오맵 기본 메뉴 보조

## 배포

Vercel로 배포 가능합니다. 환경변수를 Vercel 프로젝트 설정에 추가하세요.

```bash
vercel --prod
```

### 분석
- **Vercel Analytics**: 방문자 트래픽 분석
- **Vercel Speed Insights**: 페이지 성능(Core Web Vitals) 모니터링
- **Google AdSense**: 광고 수익화

## 기술 스택

- Express.js + Vanilla JS (프레임워크 없음)
- Leaflet (지도)
- 카카오 REST API + Panel3 API (장소/메뉴)
- Supabase (PostgreSQL - 캐싱, 로깅)
- Vercel (배포, Analytics, Speed Insights)
- Google AdSense (광고)
