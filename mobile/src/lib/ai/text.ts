// Mots fréquents de six langues, recopiés de client/src/ai/text.ts (garder identiques) :
// servent au résumé extractif des non-lus (summary.ts), calculé sur l'appareil.
export type AiLang = 'fr' | 'en' | 'es' | 'de' | 'it' | 'pt'

const LIST: Record<AiLang, string> = {
  fr: "le la les de des du un une et est en que qui pas pour dans sur avec ce cette il elle je tu nous vous ils elles on au aux mais ou ne se sont ça ai été très plus bien oui non merci bonjour salut aussi comme mon ma mes ton ta tes son sa ses leur fait faire être avoir suis moi toi qu c j d l n s t y là où donc alors quoi rien tout tous chez",
  en: "the a an and is are was were be been to of in on for with that this it i you he she we they not but or have has had do does did my your what which who will would can could just so if at by from all there their about yes no thanks hello hi me him her them our us how why when don",
  es: "el la los las de del un una y es en que no por para con se lo le les su sus pero como más muy al está están estoy yo tú él ella nosotros hola gracias sí también hay ser fue era este esta eso qué cómo porque pues bueno mi tu nos ya",
  de: "der die das und ist nicht ein eine einen zu den dem des mit auf für von sich ich du er sie wir ihr es im auch an als aber noch wie bin bist hat haben sind war wird kann ja nein danke hallo was wenn oder schon sehr gut mein dein uns euch nur doch mal hier jetzt",
  it: "il lo la i gli le di del della dei un una e è che non per con su da in sono sei ho hai ha anche come ma più molto questo questa mi ti ci si ciao grazie sì bene io tu lui lei noi voi loro cosa perché nel nella alla sono stato fatto",
  pt: "o a os as de do da dos das um uma e é que não por para com em no na nos nas se mas como mais muito ele ela eu você vocês nós sim obrigado obrigada olá também está estou são foi isso esse essa meu minha ao pelo pela tem",
}

export const STOPWORDS: Record<AiLang, Set<string>> = Object.fromEntries(
  Object.entries(LIST).map(([l, s]) => [l, new Set(s.split(' '))]),
) as Record<AiLang, Set<string>>

export const words = (text: string) => text.toLowerCase().match(/[\p{L}']+/gu)?.flatMap(w => w.split("'").filter(Boolean)) ?? []
