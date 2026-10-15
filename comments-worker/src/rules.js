// 자동 숨김 규칙. 글의 뜻이 아니라 '모양'만 보고, 확실히 위험한 것만 숨긴다.
// 욕설·시비·스팸을 가려내는 일은 AI(ai.js)가 맡는다. 여기서는 AI가 놓치기 쉬운 모양(위험한 링크, 연락처)만 본다.
// 걸린 댓글은 지우지 않고 hidden으로 저장하며, 메일의 복원 링크로 되살릴 수 있다.
//
// 링크가 있다는 것만으로는 숨기지 않는다. 정보를 보태려고 붙인 주소를 막지 않으려는 것이다.
// 아래 '위험 신호'가 있을 때만 규칙이 숨기고, 그 밖의 링크는 AI가 앞뒤 글을 보고 판단한다.

// 출처로 믿을 만한 사이트. 이 사이트의 주소는 위험 신호 검사를 건너뛴다(그래도 AI는 본다).
// 누구나 글·영상을 올리는 곳(youtube, x, facebook, tistory, medium 등)과 단축 주소는 넣지 않는다.
const TRUSTED_HOSTS = [
  "dongwook.org", "kimdongwook.com",
  "hankookilbo.com", "hani.co.kr", "khan.co.kr", "sisain.co.kr", "ytn.co.kr", "newsis.com", "munhwa.com",
  "koreaherald.com", "theguardian.com", "thenation.com", "newrepublic.com", "newleftreview.org", "jacobin.com",
  "lithub.com", "publicbooks.org", "cell.com", "doi.org", "wikipedia.org", "aladin.co.kr", "ws.or.kr", "marx21.or.kr",
];
// 기관 도메인은 스팸 업자가 쉽게 등록할 수 없어서 끝 글자로 한꺼번에 믿는다.
const TRUSTED_SUFFIXES = [".go.kr", ".ac.kr", ".edu", ".gov", ".ac.uk"];

// 위험 신호 1: 주소를 줄여 목적지를 숨기는 서비스
const SHORTENERS = [
  "bit.ly", "t.co", "goo.gl", "tinyurl.com", "is.gd", "ow.ly", "buff.ly", "cutt.ly", "rb.gy", "me2.do", "han.gl", "vo.la", "url.kr",
];
// 위험 신호 2: 광고·스팸에 많이 쓰이는 주소 끝
const SUSPICIOUS_TLDS = ["xyz", "top", "click", "shop", "site", "online", "club", "vip", "bet", "cc", "biz", "icu", "work", "loan", "win", "cyou", "buzz", "ru"];

// 주소 모양: 스킴(http://), www., 또는 '도메인/경로' 꼴. 경로 없는 이름(bbc.com)은 주소로 보지 않고 AI에 맡긴다.
const URL_LIKE = /(?:https?:\/\/|www\.)[^\s)>\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/[^\s)>\]]+/gi;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function hostOf(raw) {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// 허용 사이트 자체이거나 그 하위 주소만 믿는다. 'hani.co.kr.evil.com' 같은 위장 주소는 믿지 않는다.
function isTrusted(host) {
  if (!host) return false;
  return TRUSTED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`)) || TRUSTED_SUFFIXES.some((s) => host.endsWith(s));
}

// 위험한 링크가 있으면 그 이유를, 없으면 null을 돌려준다.
function riskyLink(text, body) {
  const untrusted = (text.match(URL_LIKE) ?? []).map((url) => ({ url, host: hostOf(url) })).filter(({ host }) => !isTrusted(host));
  if (!untrusted.length) return null;

  for (const { url, host } of untrusted) {
    if (!host) return "해석할 수 없는 주소";
    // 'hani.co.kr.evil.com'처럼 믿는 사이트 이름을 끼워 넣어 위장한 주소
    if (TRUSTED_HOSTS.some((d) => host.includes(d))) return "허용 사이트로 위장한 주소";
    if (SHORTENERS.includes(host)) return "단축 주소";
    if (SUSPICIOUS_TLDS.includes(host.split(".").pop())) return "수상한 주소 끝";
    if (IPV4.test(host)) return "숫자(IP) 주소";
  }
  if (untrusted.length >= 2) return "링크 여러 개";
  if (body.replace(URL_LIKE, "").trim().length < 12) return "링크만 있음";
  return null;
}

// ---------- 연락처 ----------
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// 한국 휴대폰·지역번호(010, 011, 016~019, 02, 031~064, 070, 080). 앞자리를 정해 두어 ISBN 같은 숫자가 걸리지 않게 한다.
const KR_PHONE = /\b0(?:10|1[16-9]|2|[3-6][1-5]|70|80)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/;
const REPRESENTATIVE_PHONE = /\b1[5-9]\d{2}[-.\s]\d{4}\b/;
const INTL_PHONE = /\+\d{1,3}(?:[-.\s]?\d{2,4}){2,4}\b/;
// 메신저 이름 바로 뒤에 아이디가 붙은 꼴('카톡 abc1234', 'line id abc1234', 'telegram: @xyz').
// 메신저를 그냥 언급한 말('signal processing', '카톡으로 공유했어요')은 걸리지 않는다.
const MESSENGER_ID = new RegExp(
  "(?:카톡|카카오톡|텔레그램|텔레|위챗|라인)\\s*(?:id|아이디)?\\s*[:：@]?\\s*@?[a-z0-9_.-]{4,}" +
    "|(?:telegram|whatsapp|wechat|kakaotalk|signal|line)\\s*(?:id|아이디)\\s*[:：]?\\s*@?[a-z0-9_.-]{4,}" +
    "|(?:telegram|whatsapp|wechat|kakaotalk|signal)\\s*[:：@]\\s*@?[a-z0-9_.-]{4,}",
  "i",
);
// ISBN·ISSN·DOI 뒤의 숫자는 전화번호가 아니다.
const BOOK_NUMBERS = /\b(?:ISBN|ISSN|DOI)\b[\s:\-]*[0-9Xx\-\s./]+/gi;

function hasContact(text) {
  const t = text.replace(BOOK_NUMBERS, " ");
  return EMAIL_PATTERN.test(t) || KR_PHONE.test(t) || REPRESENTATIVE_PHONE.test(t) || INTL_PHONE.test(t) || MESSENGER_ID.test(t);
}

// code는 쓴 사람에게 보여 줄 안내를 고르는 값이다(link, contact, repeat). reason은 알림 메일에 쓰는 설명이다.
export function classify({ name, body, isDuplicate }) {
  const text = `${name} ${body}`;

  const link = riskyLink(text, body);
  if (link) return { status: "hidden", code: "link", reason: `링크: ${link}` };

  if (hasContact(text)) return { status: "hidden", code: "contact", reason: "연락처 포함" };

  if (isDuplicate) return { status: "hidden", code: "repeat", reason: "같은 내용 반복" };

  return { status: "visible", code: null, reason: null };
}
