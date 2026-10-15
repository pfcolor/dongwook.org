// 자동 숨김 규칙. 걸린 댓글은 지우지 않고 hidden으로 저장하며, 메일의 복원 링크로 되살릴 수 있다.
// 오인이 생길 수 있는 단어는 넣지 않는다(예: '미친', 'crypto', 'loan'). 목록은 필요할 때 여기에 더한다.

// 단어 목록은 공개 저장소에 올리지 않는 로컬 파일에 있다. src/wordlists.example.js를 복사해 wordlists.local.js를 만든다.
import { ALLOWED, PROFANITY, SPAM_WORDS } from "./wordlists.local.js";

const URL_PATTERN = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|kr|co|me|ru|xyz|top|info|ly|site|online|shop|club|vip|bet|cc|biz)\b)/i;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// 한국 휴대폰·일반 전화번호와 국제번호 모양. 날짜(2026-10-15)나 금액(1,000,000)은 걸리지 않는 모양만 쓴다.
const PHONE_PATTERN = /(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|\b\d{2,4}[-.\s]\d{3,4}[-.\s]\d{4}\b|\+\d{1,3}[-.\s]?\d{6,})/;
// 메신저 이름 바로 뒤에 아이디가 붙은 모양('카톡 abc123', 'telegram: @xyz'). 메신저를 그냥 언급한 말은 걸리지 않는다.
const MESSENGER_ID = /(카톡|카카오톡|텔레그램|텔레|라인|위챗|telegram|whatsapp|wechat|kakaotalk|signal)\s*(id|아이디)?\s*[:：]?\s*@?[a-z0-9_.-]{4,}/i;

function normalize(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z]/gu, "");
}

// 영문 단어는 단어 경계를 지켜 찾는다. 공백을 지운 글자에서 찾으면 다른 낱말 속 글자가 걸린다
// (예: 'social issues' 속 'cialis', 'this hit' 속 'shit'). 글자 사이에 공백·점·별표를 끼운 변형('f u c k')은 잡고,
// 끝에 붙는 -s, -ed, -ing 같은 꼴도 같은 단어로 본다.
const ASCII_WORD = /^[a-z]+$/;
const SEPARATOR = "[\\s._*\\-]{0,2}";
const SUFFIX = "(?:s|es|ed|er|ers|ing|y)?";

function compile(words) {
  return {
    latin: words
      .filter((w) => ASCII_WORD.test(w))
      .map((w) => ({ word: w, re: new RegExp(`\\b${[...w].join(SEPARATOR)}${SUFFIX}\\b`, "i") })),
    // 한글 단어는 한글만 남긴 글자에서 찾는다. 사이에 숫자·기호를 끼운 변형('시1발')도 잡힌다.
    hangul: words.filter((w) => !ASCII_WORD.test(w)),
  };
}

const SPAM = compile(SPAM_WORDS);
const CURSE = compile(PROFANITY);

function findWord({ latin, hangul }, original, flat) {
  const hit = latin.find(({ re }) => re.test(original));
  if (hit) return hit.word;
  return hangul.find((w) => flat.includes(normalize(w)));
}

export function classify({ name, body, isDuplicate }) {
  const text = `${name} ${body}`;

  if (URL_PATTERN.test(text)) return { status: "hidden", reason: "링크 포함" };
  if (EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text) || MESSENGER_ID.test(text)) {
    return { status: "hidden", reason: "연락처 포함" };
  }

  const original = text.normalize("NFKC");
  // 단어 철자가 겹치는 정상 낱말(예: 시발점, 병신년)은 검사에서 뺀다.
  let flat = normalize(text);
  for (const word of ALLOWED) flat = flat.split(normalize(word)).join("");

  const spam = findWord(SPAM, original, flat);
  if (spam) return { status: "hidden", reason: `스팸 단어(${spam})` };

  const curse = findWord(CURSE, original, flat);
  if (curse) return { status: "hidden", reason: `욕설 단어(${curse})` };

  if (isDuplicate) return { status: "hidden", reason: "같은 내용 반복" };

  return { status: "visible", reason: null };
}
