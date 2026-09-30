// ---- shared/names.js (included by scripts/build-n8n.mjs) ------------------
// Hard rule 4: no family or deceased names in columns, logs or AI prompts.
// PLAN.md 5.4 - the exact rules still need Rob's sign-off.
//
// makeNameFilters(extraAllowPhrases) returns:
//   filterTerm(raw)   -> { stored, filtered } for search terms: a name-bearing
//                        term becomes "[name removed - <intent>]"
//   redactNames(text) -> free text (messages, chat) with name words replaced
//                        by "[name]"
// A term is name-bearing when it has an obituary/death-notice phrase, a common
// first name that is not an allowed word, or a common surname with no
// funeral-business word next to it ("smith funeral home" is a business and is
// kept; "john smith" is not). Removing a harmless word is the safe direction.

const NAME_INTENT = [
  ['obituary', 'obituary'], ['obituaries', 'obituary'], ['obit', 'obituary'], ['obits', 'obituary'],
  ['passed away', 'death notice'], ['death notice', 'death notice'], ['death notices', 'death notice'],
  ['in loving memory', 'memorial'], ['celebration of life for', 'memorial'], ['memorial for', 'memorial'],
  ['service for', 'service'], ['services for', 'service'], ['visitation for', 'service'], ['funeral for', 'service'],
  ['condolences', 'obituary'], ['guestbook', 'obituary'], ['guest book', 'obituary'],
];
const FIRST_NAMES = new Set(('james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony ' +
  'donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric ' +
  'jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick raymond dennis tyler aaron jose adam ' +
  'nathan henry douglas zachary peter kyle ethan walter noah jeremy christian keith roger terry gerald harold sean austin carl arthur ' +
  'lawrence dylan jesse jordan bryan billy joe bruce gabriel logan albert willie alan juan wayne elijah randy roy vincent ralph eugene ' +
  'russell bobby louis philip johnny howard fred earl jimmy leonard stanley norman lloyd clarence herbert ernest melvin francis ' +
  'mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna ' +
  'michelle carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela ' +
  'emma nicole helen samantha katherine christine debra rachel carolyn janet catherine maria heather diane julie joyce victoria kelly ' +
  'christina lauren joan evelyn olivia judith megan cheryl martha andrea frances hannah jacqueline gloria teresa kathryn sara janice ' +
  'jean alice madison doris abigail julia judy beverly denise marilyn danielle theresa sophia marie diana brittany natalie isabella ' +
  'charlotte irene alexis kayla lori tiffany gladys wanda mildred dolores edna ethel lillian thelma bernice norma florence ' +
  'eleanor agnes louise ruth anne annie marjorie esther virginia phyllis lois geraldine loretta darlene connie peggy ' +
  'mohammed muhammad ahmed ali fatima priya raj wei li chen nguyen').split(/\s+/));
const SURNAMES = new Set(('smith johnson williams jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson ' +
  'thomas taylor moore jackson martin lee perez thompson harris sanchez clark ramirez lewis robinson walker allen wright scott torres ' +
  'nguyen flores adams nelson baker hall rivera campbell mitchell carter roberts gomez phillips evans turner diaz parker cruz edwards ' +
  'collins reyes stewart morris morales murphy cook rogers gutierrez ortiz morgan cooper peterson bailey reed kelly howard ramos kim ' +
  'cox ward richardson watson brooks chavez wood james bennett gray mendoza ruiz hughes alvarez castillo sanders patel myers long ross ' +
  'foster jimenez powell jenkins perry russell sullivan bell coleman butler henderson barnes gonzales fisher vasquez simmons romero ' +
  'jordan patterson alexander hamilton graham reynolds griffin wallace moreno west cole hayes bryant herrera gibson ellis tran medina ' +
  'aguilar stevens murray ford castro marshall owens harrison fernandez mcdonald woods washington kennedy wells vargas henry chen ' +
  'freeman webb tucker guzman burns crawford olson simpson porter hunter gordon mendez silva shaw snyder mason dixon munoz hunt hicks ' +
  'holmes palmer wagner black robertson boyd rose stone salazar fox warren mills meyer rice schmidt garza daniels ferguson nichols ' +
  'stephens soto weaver ryan gardner payne grant dunn kelley spencer hawkins arnold pierce hansen peters santos hart bradley knight ' +
  'elliott cunningham duncan armstrong hudson carroll lane riley andrews ray berry perkins hoffman johnston matthews pena richards ' +
  'willis carpenter lawrence sandoval').split(/\s+/));
// Words that are also names but common in funeral searches, or are places.
const NAME_ALLOW = new Set(('home homes funeral funerals cremation cremations crematory crematorium mortuary chapel chapels cemetery ' +
  'burial burials memorial memorials service services casket caskets urn urns direct cost costs price prices near me the and of for ' +
  'in with how much what is a to plan plans preplan pre planning prepaid prearranged arrangements cheap affordable best top local ' +
  'grace hope faith joy rose may june april august summer dawn lily ivy pearl ruby crystal amber holly will mark long hall bell stone ' +
  'wood woods hill park ward west north south east wells love price cook church king young green white brown black gray grey rice ' +
  'lane grant hunt fox shaw reed bailey mason hunter parker cooper carter brooks gardner ford washington jordan virginia ' +
  'florence charlotte victoria madison austin eugene lawrence augusta marshall franklin lincoln jackson hamilton warren').split(/\s+/));
const NAME_BUSINESS = new Set('funeral funerals home homes mortuary chapel chapels cremation cremations crematory crematorium cemetery memorial'.split(' '));

function makeNameFilters(extraAllowPhrases) {
  const extra = new Set();
  for (const phrase of extraAllowPhrases || []) {
    for (const w of String(phrase).toLowerCase().split(/[^a-z0-9']+/)) if (w) extra.add(w);
  }
  const allowed = (w) => NAME_ALLOW.has(w) || extra.has(w);
  // "smith's" / "smiths'" -> "smith", so possessives do not slip through.
  const base = (w) => w.replace(/'s$|'$/, '');
  const isName = (w) => (FIRST_NAMES.has(base(w)) || SURNAMES.has(base(w))) && !allowed(base(w));

  function filterTerm(raw) {
    const term = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    for (const [phrase, intent] of NAME_INTENT) {
      if (` ${term} `.includes(` ${phrase} `)) return { stored: `[name removed - ${intent}]`, filtered: true };
    }
    const words = term.split(/[^a-z0-9']+/).filter(Boolean);
    const hasBusiness = words.some((w) => NAME_BUSINESS.has(w));
    if (words.some((w) => FIRST_NAMES.has(base(w)) && !allowed(base(w)))) return { stored: '[name removed - name]', filtered: true };
    if (!hasBusiness && words.some((w) => SURNAMES.has(base(w)) && !allowed(base(w)))) return { stored: '[name removed - name]', filtered: true };
    return { stored: term, filtered: false };
  }

  function redactNames(text) {
    return String(text || '').replace(/[A-Za-z][A-Za-z']*/g, (word) => (isName(word.toLowerCase()) ? '[name]' : word));
  }

  return { filterTerm, redactNames };
}
// ---- end shared/names.js ----------------------------------------------------
