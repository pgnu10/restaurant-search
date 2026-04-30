const FRANCHISE_MENUS = {
  맥도날드: [
    { name: "빅맥", price: 6500 },
    { name: "빅맥 세트", price: 8900 },
    { name: "1955버거", price: 7500 },
    { name: "맥너겟 6조각", price: 4500 },
    { name: "맥스파이시 상하이 버거", price: 6800 },
  ],
  버거킹: [
    { name: "와퍼", price: 8400 },
    { name: "와퍼 세트", price: 11400 },
    { name: "콰트로치즈와퍼", price: 9900 },
    { name: "불고기와퍼", price: 6900 },
  ],
  KFC: [
    { name: "징거버거", price: 6900 },
    { name: "징거버거 세트", price: 8900 },
    { name: "타워버거", price: 7400 },
    { name: "핫크리스피치킨", price: 3200 },
  ],
  롯데리아: [
    { name: "불고기버거", price: 4600 },
    { name: "새우버거", price: 5200 },
    { name: "데리버거", price: 4600 },
    { name: "한우불고기버거", price: 6900 },
  ],
  맘스터치: [
    { name: "싸이버거", price: 4900 },
    { name: "불고기버거", price: 3900 },
    { name: "휠렛버거", price: 4400 },
    { name: "통새우버거", price: 5400 },
  ],
  "노브랜드버거": [
    { name: "NBB 치즈버거", price: 4400 },
    { name: "NBB 더블치즈버거", price: 6200 },
    { name: "그릴드불고기 버거", price: 5200 },
  ],
  도미노피자: [
    { name: "포테이토 피자 M", price: 19900 },
    { name: "슈퍼디럭스 피자 M", price: 22900 },
    { name: "페퍼로니 피자 M", price: 16900 },
  ],
  "피자헛": [
    { name: "리치골드 피자 M", price: 24900 },
    { name: "페퍼로니 피자 M", price: 17900 },
    { name: "슈퍼슈프림 피자 M", price: 22900 },
  ],
  BBQ: [
    { name: "황금올리브치킨", price: 20000 },
    { name: "자메이카 통다리구이", price: 20000 },
    { name: "황금올리브 반반", price: 21000 },
  ],
  BHC: [
    { name: "뿌링클", price: 20000 },
    { name: "맛초킹", price: 20000 },
    { name: "골드킹", price: 20000 },
  ],
  교촌치킨: [
    { name: "교촌오리지날", price: 19000 },
    { name: "교촌레드", price: 20000 },
    { name: "교촌허니콤보", price: 20000 },
  ],
};

export function getFranchiseMenus(placeName) {
  for (const [brand, menus] of Object.entries(FRANCHISE_MENUS)) {
    if (placeName.includes(brand)) return menus;
  }
  return null;
}
