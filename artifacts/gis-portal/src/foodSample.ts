// 🍜 美食地圖原型的示範資料——店名都是虛構的，座標只取大概的區域。
// 接上知識庫（/api/hermes-food）後就不再使用；畫面上會標「示範資料」。
import { parseFoodPayload, type FoodData } from './foodMap'

const RAW = {
  receivedAt: '2026-10-15T08:00:00+08:00',
  places: [
    { id: 'FOOD-0001', name: '示範・巷口牛肉麵', area: '台北 大安', lat: 25.0330, lng: 121.5434, cuisine: '牛肉麵', tags: ['宵夜', '一個人'], status: 'want', priceLevel: 2, why: '同事說湯頭是近年喝過最清的', source: '同事', mustTry: ['清燉牛肉麵'], addedAt: '2026-06-02', days: ['2026-06-02'] },
    { id: 'FOOD-0002', name: '示範・河岸早午餐', area: '台北 中山', lat: 25.0571, lng: 121.5230, cuisine: '早午餐', tags: ['約會', '週末'], status: 'visited', priceLevel: 3, why: '想找能坐久一點的地方', source: 'IG', mustTry: ['班尼迪克蛋'], rating: 4, addedAt: '2026-05-11', visitedAt: '2026-09-21', days: ['2026-05-11', '2026-09-21'] },
    { id: 'FOOD-0003', name: '示範・老街肉圓', area: '新竹 北區', lat: 24.8066, lng: 120.9686, cuisine: '小吃', tags: ['出差順路'], status: 'favorite', priceLevel: 1, why: '出差路上順便', source: '我', mustTry: ['肉圓', '貢丸湯'], rating: 5, addedAt: '2026-03-18', visitedAt: '2026-10-03', days: ['2026-03-18', '2026-07-09', '2026-10-03'] },
    { id: 'FOOD-0004', name: '示範・山腳下咖啡', area: '台中 北屯', lat: 24.1820, lng: 120.7170, cuisine: '咖啡', tags: ['景觀', '週末'], status: 'want', priceLevel: 2, why: '看到照片，窗外是整片山', source: 'YouTube', mustTry: [], addedAt: '2026-08-27', days: ['2026-08-27'] },
    { id: 'FOOD-0005', name: '示範・市場鱔魚意麵', area: '台南 中西', lat: 22.9917, lng: 120.2010, cuisine: '小吃', tags: ['旅行清單'], status: 'want', priceLevel: 1, why: '台南必吃清單裡唯一還沒吃的', source: '朋友', mustTry: ['乾炒鱔魚意麵'], addedAt: '2026-01-20', days: ['2026-01-20', '2026-09-30'] },
    { id: 'FOOD-0006', name: '示範・港邊海產', area: '高雄 鼓山', lat: 22.6205, lng: 120.2690, cuisine: '海鮮', tags: ['聚餐', '旅行清單'], status: 'visited', priceLevel: 3, why: '家族旅遊想找大桌的店', source: '家人', mustTry: ['鹽烤魚'], rating: 3, addedAt: '2026-04-04', visitedAt: '2026-04-19', days: ['2026-04-04', '2026-04-19'] },
    { id: 'FOOD-0007', name: '示範・深夜拉麵', area: '台北 信義', lat: 25.0400, lng: 121.5680, cuisine: '拉麵', tags: ['宵夜'], status: 'want', priceLevel: 2, why: '加班後想吃重口味', source: '我', mustTry: ['豚骨拉麵'], addedAt: '2026-09-29', days: ['2026-09-29'] },
    { id: 'FOOD-0008', name: '示範・溫泉區甜品', area: '宜蘭 礁溪', lat: 24.8270, lng: 121.7700, cuisine: '甜點', tags: ['旅行清單', '週末'], status: 'skip', priceLevel: 2, why: '排隊名店', source: 'IG', mustTry: [], rating: 2, addedAt: '2026-02-08', visitedAt: '2026-02-15', days: ['2026-02-08', '2026-02-15'] },
    // 只有 Google 地圖連結、沒有 lat/lng：驗證「從連結取座標」
    { id: 'FOOD-0009', name: '示範・港式燒臘', area: '台北 萬華', cuisine: '燒臘', tags: ['一個人'], status: 'want', priceLevel: 1, why: '路過聞到很香', source: '我', mustTry: ['三寶飯'], addedAt: '2026-10-10', days: ['2026-10-10'], mapUrl: 'https://www.google.com/maps/place/x/@25.0365,121.4999,17z' },
    // 沒有任何座標：只會出現在清單，地圖上提示「n 家還沒有座標」
    { id: 'FOOD-0010', name: '示範・朋友推的私房菜', area: null, cuisine: '台菜', tags: ['聚餐'], status: 'want', priceLevel: 3, why: '只知道在花蓮，地址還沒問', source: '朋友', mustTry: [], addedAt: '2026-07-14', days: ['2026-07-14'] },
  ],
}

export function sampleFoodData(): FoodData {
  return { ...parseFoodPayload(RAW), sample: true }
}
