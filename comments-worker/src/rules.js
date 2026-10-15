// 자동 숨김 규칙. 걸린 댓글은 지우지 않고 hidden으로 저장하며, 메일의 복원 링크로 되살릴 수 있다.
// 오인이 생길 수 있는 단어는 넣지 않는다(예: '미친'). 단어 목록은 필요할 때 여기에 더한다.

// 한글과 영문 소문자만 남겨 비교한다. 공백·숫자·기호를 끼워 넣은 변형('시1발', 'f.u.c.k')도 잡으려는 것이다.
const PROFANITY = [
  // (단어 목록은 저장소에서 제거했습니다)
];

const URL_PATTERN = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|kr|co|me|ru|xyz|top|info|ly)\b)/i;

function normalize(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z]/gu, "");
}

export function classify({ name, body, isDuplicate }) {
  const text = `${name} ${body}`;

  if (URL_PATTERN.test(text)) return { status: "hidden", reason: "링크 포함" };

  const flat = normalize(text);
  const hit = PROFANITY.find((word) => flat.includes(normalize(word)));
  if (hit) return { status: "hidden", reason: `욕설 단어(${hit})` };

  if (isDuplicate) return { status: "hidden", reason: "같은 내용 반복" };

  return { status: "visible", reason: null };
}
