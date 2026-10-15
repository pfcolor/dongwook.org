// 욕설·스팸 단어 목록의 형식 예시. 실제 목록은 이 파일을 복사해 만든 wordlists.local.js에 둔다.
// wordlists.local.js는 공개 저장소에 올리지 않는다(.gitignore). 없으면 배포(번들)가 실패한다.
//
// 단어는 한글 또는 영문 소문자로만 적는다(공백·기호 없이).
// - 영문 단어는 단어 경계를 지켜 찾고, 글자 사이에 공백·점을 끼운 변형도 잡는다('f u c k'). 구(phrase)는 붙여 쓴다('workfromhome').
// - 한글 단어는 한글만 남긴 글자에서 찾으므로 숫자·기호를 끼운 변형도 잡는다.

export const PROFANITY = ["예시욕설"];

export const SPAM_WORDS = ["casino", "카지노"];

// 위 단어와 철자가 겹치지만 정상인 낱말. 한글 단어를 검사하기 전에 글에서 뺀다.
export const ALLOWED = [];
