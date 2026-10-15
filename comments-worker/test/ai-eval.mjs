// 사용법: wrangler dev(포트 8787)를 켠 뒤 `node test/ai-eval.mjs [모델ID ...]`
import { readFileSync } from "node:fs";

const set = JSON.parse(readFileSync(new URL("./eval-set.json", import.meta.url)));
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

  let hitOk = 0, totalOk = 0, hitAbusive = 0, totalAbusive = 0;
  const wrong = [];
  const unsure = [];
  results.forEach((r, i) => {
    const { label, text } = set[i];
    if (label === "?") return unsure.push(`${r.verdict}  ${text}`);
    if (label === "OK") { totalOk++; r.verdict === "OK" ? hitOk++ : wrong.push(`정상인데 숨김: ${text}`); }
    else { totalAbusive++; r.verdict === "ABUSIVE" ? hitAbusive++ : wrong.push(`욕설인데 통과: ${text}`); }
  });

  console.log(`\n## ${model}  (${((Date.now() - started) / 1000).toFixed(1)}초)`);
  console.log(`정상 댓글 통과 ${hitOk}/${totalOk}, 욕설·시비 숨김 ${hitAbusive}/${totalAbusive}`);
  wrong.forEach((w) => console.log("  ✗ " + w));
  console.log("애매한 것(정답 없음):");
  unsure.forEach((u) => console.log("  · " + u));
  console.log("원응답 예시:", JSON.stringify(results.slice(0, 3).map((r) => r.raw)));
}
