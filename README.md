# restaurant-search

카카오맵 기반 음식점 메뉴/가격 비교 CLI 도구.

위치와 메뉴 키워드를 입력하면 주변 음식점을 검색하고, 해당 키워드가 포함된 메뉴와 가격을 CSV로 출력합니다.

## 설치

```bash
npm install
```

## 설정

`.env` 파일에 카카오 REST API 키를 설정합니다.

```
KAKAO_REST_API_KEY=your_api_key_here
```

카카오 API 키는 [Kakao Developers](https://developers.kakao.com/)에서 발급받을 수 있습니다.

## 사용법

```bash
node search.js "위치" "메뉴키워드"
```

### 예시

```bash
# 사당역 근처 보쌈 가격 비교
node search.js 사당역 보쌈

# 강남역 근처 피자 가격 비교
node search.js 강남역 피자

# CSV 파일로 저장
node search.js 사당역 보쌈 > result.csv
```

### 출력 형식

CSV (가격 오름차순 정렬):

```
가게명,주소,전화,메뉴명,가격,카카오맵
한양왕족발,서울 서초구 방배천로2안길 15,02-523-3006,보쌈 (소),32000,http://place.map.kakao.com/1266543884
족팔려 사당역본점,서울 관악구 남현3길 75,02-3474-5822,한돈(생)보쌈,36000,http://place.map.kakao.com/13078844
```

진행 메시지는 stderr로 출력되므로, `> file.csv` 리다이렉트 시 CSV 데이터만 파일에 저장됩니다.

## 동작 원리

1. **카카오 로컬 API**로 위치 좌표 변환 + 반경 2km 내 음식점 검색 (최대 45개)
2. **Puppeteer**로 각 음식점의 카카오맵 페이지를 열고, 내부 API 응답을 가로채서 메뉴/가격 추출
3. 메뉴 키워드로 필터링 후 가격 오름차순 CSV 출력

가격 데이터는 요기요 연동 메뉴(정확한 가격)를 우선 사용하고, 없으면 카카오맵 기본 메뉴를 사용합니다.
