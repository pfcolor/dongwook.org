// 사용법: wrangler dev(포트 8787)를 켠 뒤 `node test/ai-eval.mjs [모델ID ...]`
// 시험 세트(test/eval-set.local.json)는 욕설 예시가 들어 있어 공개 저장소에 올리지 않는다(.gitignore).
// 형식: [{ "label": "OK" | "ABUSIVE" | "SPAM" | "?", "text": "댓글 내용" }, ...]
import { existsSync, readFileSync } from "node:fs";

const setPath = new URL("./eval-set.local.json", import.meta.url);
if (!existsSync(setPath)) {
  console.error("test/eval-set.local.json이 없습니다. 위 형식으로 만들어 두세요(저장소에는 없습니다).");
  process.exit(1);
}
const set = JSON.parse(readFileSync(setPath));
const models = process.argv.slice(2);
if (!models.length) models.push("@cf/qwen/qwen3-30b-a3b-fp8");

for (const model of models) {
  const started = Date.now();
  const res = await fetch("http://localhost:8787/_ai-eval", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:4000" },
    body: JSON.stringify({ model, texts: set.map((s) => s.text) }),
  });
  if (!res.ok) {
    console.log(`\n## ${model}\n실패: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const { results } = await res.json();

  const total = { OK: 0, ABUSIVE: 0, SPAM: 0 };
  const hit = { OK: 0, ABUSIVE: 0, SPAM: 0 };
  const wrong = [];
  const unsure = [];
  results.forEach((r, i) => {
    const { label, text } = set[i];
    if (label === "?") return unsure.push(`${r.verdict}  ${text}`);
    total[label]++;
    if (r.verdict === label) hit[label]++;
    else wrong.push(`정답 ${label} → 판정 ${r.verdict}: ${text}`);
  });

  console.log(`\n## ${model}  (${((Date.now() - started) / 1000).toFixed(1)}초)`);
  console.log(`정상 통과 ${hit.OK}/${total.OK}, 욕설·시비 ${hit.ABUSIVE}/${total.ABUSIVE}, 스팸 ${hit.SPAM}/${total.SPAM}`);
  wrong.forEach((w) => console.log("  ✗ " + w));
  console.log("애매한 것(정답 없음):");
  unsure.forEach((u) => console.log("  · " + u));
}
