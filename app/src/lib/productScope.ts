/** 제품을 특정하지 않은 관리 질문에는 생성 전에 제품명을 확인한다. */
export function productClarification(question: string): string | null {
  const care = /세탁|세척|빨아|빨래|건조|세제|유연제|탈수/.test(question)
  const product = /트래블|travel|리포머|reformer|TPE|PVC|천연고무|코르크|황마|요가타[올월]/i.test(question)
  if (!care || product) return null
  return '어떤 제품의 세탁·관리 방법이 궁금하신가요? 제품명과 궁금한 관리 방법을 함께 적어주세요. 예: “트래블매트는 세탁해도 되나요?” 제품마다 관리 방법이 달라 트래블매트의 안내를 다른 매트에 그대로 적용할 수는 없습니다.'
}
