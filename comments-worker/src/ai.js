// Workers AI로 명백한 욕설·인신공격·혐오·시비 댓글만 가려낸다.
// 애매하면 OK로 둔다. 숨김은 복원할 수 있지만, 정당한 반대 의견이 숨겨지면 대화를 막기 때문이다.

export const DEFAULT_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const SYSTEM_PROMPT = `너는 개인 블로그의 댓글 검수자다. 댓글이 아래에 해당하면 ABUSIVE, 아니면 OK라고만 답한다. 다른 말은 쓰지 않는다.

ABUSIVE: 욕설, 모욕, 인신공격, 특정 집단에 대한 혐오 표현, 글쓴이를 깎아내리거나 도발하려는 시비. 욕설을 기호나 숫자, 공백으로 변형한 것도 포함한다.

OK: 공감, 감사, 질문, 정보나 사례 보태기, 오탈자 지적, 예의를 지킨 반대와 비판, 근거를 묻는 말. 글의 주제가 민감해도 댓글이 예의를 지키면 OK다. 욕설과 비슷하게 생겼어도 일반 단어로 쓰인 것(예: '시발점', 음식 이름)은 OK다.

판단이 애매하면 OK라고 답한다.`;

export async function judge(env, text, model = DEFAULT_MODEL) {
  const result = await env.AI.run(model, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `댓글:\n"""\n${text.slice(0, 1000)}\n"""` },
    ],
    max_tokens: 8,
    temperature: 0,
    // Qwen3 계열의 생각 모드를 끈다(다른 모델은 무시한다).
    chat_template_kwargs: { enable_thinking: false },
  });

  const raw = extract(result);
  return { verdict: /ABUSIVE/i.test(raw) ? "ABUSIVE" : "OK", raw };
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
