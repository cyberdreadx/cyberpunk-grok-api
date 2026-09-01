/**
 * Plain-language age gate, in every locale.
 *
 * The gate is a legal surface: it is where the user asserts their age and
 * accepts the Terms. The old copy asked them to confirm their "biological
 * chassis has completed 18 solar rotations" and warned about "corporate
 * security drones" — funny, but it makes the one screen that has to be an
 * unambiguous record of consent read as a bit. The cyberpunk tone stays
 * everywhere else; it comes off here.
 *
 * Only the six strings that carry meaning are rewritten. Titles, terminal
 * flavour lines and button labels keep their voice.
 *
 *   node --import tsx scripts/rewrite-agegate-copy.mts
 */
import { readFileSync, writeFileSync } from "fs";

const BRAND = "GLTCH Runner";

/** description, warning, ageCheck, tosCheck, privacyCheck, confirmDisabled */
const COPY: Record<string, Record<string, string>> = {
  en: {
    description: `You must be 18 or older to use ${BRAND}.`,
    warning: "This site contains adult content.",
    ageCheck: "I am {{age}} or older.",
    tosCheck: "I agree to the",
    privacyCheck: "I have read the",
    confirmDisabled: "CHECK ALL THREE TO CONTINUE",
  },
  es: {
    description: `Debes tener 18 años o más para usar ${BRAND}.`,
    warning: "Este sitio contiene contenido para adultos.",
    ageCheck: "Tengo {{age}} años o más.",
    tosCheck: "Acepto los",
    privacyCheck: "He leído la",
    confirmDisabled: "MARCA LAS TRES CASILLAS PARA CONTINUAR",
  },
  de: {
    description: `Du musst 18 Jahre oder älter sein, um ${BRAND} zu nutzen.`,
    warning: "Diese Website enthält Inhalte für Erwachsene.",
    ageCheck: "Ich bin {{age}} Jahre oder älter.",
    tosCheck: "Ich stimme den",
    privacyCheck: "Ich habe die",
    confirmDisabled: "ALLE DREI FELDER ANKREUZEN, UM FORTZUFAHREN",
  },
  fr: {
    description: `Vous devez avoir 18 ans ou plus pour utiliser ${BRAND}.`,
    warning: "Ce site contient du contenu pour adultes.",
    ageCheck: "J'ai {{age}} ans ou plus.",
    tosCheck: "J'accepte les",
    privacyCheck: "J'ai lu la",
    confirmDisabled: "COCHEZ LES TROIS CASES POUR CONTINUER",
  },
  pt: {
    description: `Você precisa ter 18 anos ou mais para usar o ${BRAND}.`,
    warning: "Este site contém conteúdo adulto.",
    ageCheck: "Tenho {{age}} anos ou mais.",
    tosCheck: "Concordo com os",
    privacyCheck: "Li a",
    confirmDisabled: "MARQUE AS TRÊS CAIXAS PARA CONTINUAR",
  },
  ja: {
    description: `${BRAND} のご利用は18歳以上に限られます。`,
    warning: "このサイトには成人向けコンテンツが含まれます。",
    ageCheck: "私は{{age}}歳以上です。",
    tosCheck: "同意します:",
    privacyCheck: "読みました:",
    confirmDisabled: "3つすべてにチェックしてください",
  },
  ko: {
    description: `${BRAND}을(를) 이용하려면 만 18세 이상이어야 합니다.`,
    warning: "이 사이트에는 성인용 콘텐츠가 포함되어 있습니다.",
    ageCheck: "저는 만 {{age}}세 이상입니다.",
    tosCheck: "동의합니다:",
    privacyCheck: "읽었습니다:",
    confirmDisabled: "세 항목을 모두 체크하세요",
  },
  zh: {
    description: `您必须年满 18 岁才能使用 ${BRAND}。`,
    warning: "本网站包含成人内容。",
    ageCheck: "我已年满 {{age}} 岁。",
    tosCheck: "我同意",
    privacyCheck: "我已阅读",
    confirmDisabled: "勾选全部三项以继续",
  },
  hi: {
    description: `${BRAND} का उपयोग करने के लिए आपकी आयु 18 वर्ष या अधिक होनी चाहिए।`,
    warning: "इस साइट पर वयस्क सामग्री है।",
    ageCheck: "मैं {{age}} वर्ष या उससे अधिक का/की हूँ।",
    tosCheck: "मैं सहमत हूँ:",
    privacyCheck: "मैंने पढ़ा है:",
    confirmDisabled: "जारी रखने के लिए तीनों बॉक्स चुनें",
  },
  ar: {
    description: `يجب أن يكون عمرك 18 عامًا أو أكثر لاستخدام ${BRAND}.`,
    warning: "يحتوي هذا الموقع على محتوى للبالغين.",
    ageCheck: "عمري {{age}} عامًا أو أكثر.",
    tosCheck: "أوافق على",
    privacyCheck: "لقد قرأت",
    confirmDisabled: "حدد الخانات الثلاث للمتابعة",
  },
};

for (const [lang, copy] of Object.entries(COPY)) {
  const path = `/home/neon/cyberpunk-grok-api/src/locales/${lang}.json`;
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data.ageGate) {
    console.log(`  skip ${lang} — no ageGate block`);
    continue;
  }
  for (const [key, value] of Object.entries(copy)) data.ageGate[key] = value;
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`  ok   ${lang}: ${Object.keys(copy).length} strings`);
}
console.log("\nTitles, button labels and terminal flavour lines left untouched.");
