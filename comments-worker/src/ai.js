// Workers AI로 명백한 욕설·시비와 스팸만 가려낸다.
// 애매하면 OK로 둔다. 숨김은 복원할 수 있지만, 정당한 반대 의견이 숨겨지면 대화를 막기 때문이다.

export const DEFAULT_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

// 영어 스팸이 많을 것이라 지시문은 영어로 쓰고, 댓글은 어떤 언어든 같은 기준으로 본다.
const SYSTEM_PROMPT = `You moderate comments on a personal blog about society, religion, language and books. Comments may be in Korean or English (or other languages). Reply with exactly one word: OK, ABUSIVE, or SPAM.

ABUSIVE: insults, profanity (including obfuscated forms like "f u c k" or "시1발"), personal attacks on the author or other commenters, hate speech against a group, or comments written only to provoke or demean.

SPAM: advertising or promotion of any product, service, site, or channel; SEO, link-building or traffic-selling offers; scams and get-rich-quick schemes (loans, investment, crypto signals, casino, betting, adult content, fake prizes); solicitation to contact someone privately (messenger IDs, phone numbers, "DM me"); relationship or escort bait; copy-pasted irrelevant text or gibberish.

OK: everything else, including thanks, praise, questions, requests for sources, additional information or examples from other countries, typo or translation corrections, and polite disagreement or criticism, even on sensitive topics. Short generic praise such as "Great post, thanks for sharing" is OK. A word that merely looks like a banned word but is used normally (for example 시발점, a food name) is OK.

If you are unsure, answer OK.`;

export async function judge(env, text, model = DEFAULT_MODEL) {
  // 로컬 시험에서 AI 실패 경로를 확인하기 위한 스위치. 배포본에는 DEV가 없어 동작하지 않는다.
  if (env.DEV === "1" && env.DEV_AI_FAIL === "1") throw new Error("시험용 강제 실패");

  const result = await env.AI.run(model, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Comment:\n"""\n${text.slice(0, 1000)}\n"""` },
    ],
    max_tokens: 8,
    temperature: 0,
    // Qwen3 계열의 생각 모드를 끈다(다른 모델은 무시한다).
    chat_template_kwargs: { enable_thinking: false },
  });

  const raw = extract(result);
  const verdict = /ABUSIVE/i.test(raw) ? "ABUSIVE" : /SPAM/i.test(raw) ? "SPAM" : "OK";
  return { verdict, raw };
}

// 모델마다 응답 모양이 달라 여러 자리를 차례로 본다(Qwen3는 답이 reasoning_content에 들어온다).
function extract(result) {
  if (typeof result?.response === "string") return result.response;
  const message = result?.choices?.[0]?.message;
  for (const value of [message?.content, message?.reasoning_content, message?.reasoning]) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}
