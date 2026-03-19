export default function Disclaimer() {
  return (
    <div className="rounded-2xl border border-amber-700/30 bg-amber-950/20 p-4">
      <div className="flex items-start gap-3">
        <span className="text-amber-500 text-sm leading-none mt-0.5 shrink-0">⚠</span>
        <div>
          <p className="text-xs font-black text-amber-400 mb-1.5 uppercase tracking-wider">투자 유의사항</p>
          <p className="text-xs text-amber-200/60 leading-relaxed">
            본 신호는 <span className="font-bold text-amber-200/80">수급·기술적 분석에만 기반</span>하며
            투자를 권유하지 않습니다. 주가는 실적·뉴스·시장 환경 등 다양한 요인에 영향받습니다.{' '}
            <span className="font-bold text-amber-200/80">투자 결정은 본인 책임입니다.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
