# Organizer playbook (हिंदी)

अपने event पर Showmark से check-in कैसे चलाएँ। Venue पर setup में लगभग 10 मिनट लगते हैं, और एक दिन पहले 10 मिनट की तैयारी। English version `ORGANIZER_PLAYBOOK.md` में है।

सीधी बात: दरवाज़े पर रखी screen पर एक code दिखता है जो हर 15 seconds में बदल जाता है। लोग अपने phone का camera उस पर रखते हैं, एक बार tap करते हैं, और उनकी हाज़िरी QIE Mainnet पर दर्ज हो जाती है, साथ में उनके passport में एक stamp लग जाता है। न कोई app चाहिए, न wallet, और gas का एक पैसा भी उन्हें नहीं देना पड़ता। अगर कोई sponsor आपके event के लिए पैसे दे रहा है, तो हर check-in पर sponsor के budget से आपको और attendee दोनों को पैसा मिलता है।

पहला draft, 19 Nov 2026। जहाँ `[[FILL: ...]]` लिखा है, वो बातें पहले असली event से पहले live app से मिलाकर पक्की की जाएँगी।

## क्या-क्या चाहिए

- दरवाज़े के लिए एक device: laptop, tablet या कोई extra phone, जिसमें Chrome updated हो। इसे charging पर लगाकर रखें और sleep और screen lock बंद कर दें।
- दरवाज़े पर internet, venue के Wi-Fi से या किसी phone के hotspot से।
- Organizer console में sign in करने के लिए Chrome में या phone पर QIE Wallet, और setup वाले transactions के लिए थोड़ा सा QIE (`[[FILL: mainnet पर event बनाने और door key authorize करने का असली खर्च]]`)।
- Hall बड़ा हो तो projector या बड़ी screen। यह ज़रूरी नहीं है।
- नीचे बताए गए posters, print करके।
- पहले 15 मिनट दरवाज़े पर एक साथी।

## कौन सा proof mode चुनें

- **Mode 1, door QR।** Door screen पर एक signed code चलता है जो हर 15 seconds में बदलता है, और लोग उसे खुद scan करते हैं। इसमें staff नहीं लगता और बड़ी भीड़ भी आराम से निकल जाती है, इसलिए ज़्यादातर events के लिए यही ठीक है। इसकी बस एक कमज़ोरी है: hall के अंदर बैठा कोई इंसान screen को live stream करके बाहर बैठे दोस्त को दिखा सकता है। इसीलिए door screen को कभी online share नहीं करना है।
- **Mode 2, door आपको scan करता है।** हर attendee अपना passport खोलकर अपना code दिखाता है और आपका साथी door device से उसे scan करता है। यह थोड़ा धीमा है, पर proof उसी एक इंसान से जुड़ जाता है, और internet न हो तब भी door device scans को queue में रख लेता है। जब sponsor mode 2 माँगे, या venue पर signal न हो, तब इसे चलाएँ। `[[FILL: door screen में mode 2 का scanner कहाँ है, पक्का करें]]`

अगर sponsor के campaign में mode 2 ज़रूरी है, तो mode 1 वाले check-in दर्ज तो होंगे, पर sponsor उनके पैसे नहीं देगा।

## एक दिन पहले (लगभग 10 मिनट)

1. `[[FILL: app URL]]/organize` खोलें और QIE Wallet से sign in करें।
2. Event बनाएँ: नाम, venue, शहर, शुरू और खत्म होने का time, capacity (hall में कितने लोग आ सकते हैं) और proof mode। Time दो बार check कर लें, क्योंकि event बनने के बाद time नहीं बदला जा सकता। Check-in शुरू होने से एक घंटा पहले खुल जाता है और खत्म होने के एक घंटे बाद तक चलता है।
3. अगर कोई sponsor आपके event के पैसे दे रहा है, तो उसे event का link भेज दें ताकि वो अपने campaign में आपका event approve कर सके।
4. जिस device को दरवाज़े पर लगाना है, उसी पर एक बार door screen खोलें: `[[FILL: app URL]]/door/[[FILL: event id]]`। यह उसी browser के अंदर एक door key बनाता है, जिसे आप wallet से एक signature देकर authorize करते हैं। Event वाले दिन यही device और यही browser लेकर आएँ, क्योंकि door key सिर्फ उसी browser में रहती है।
5. Door device का clock "automatic time" पर रखें। Time बहुत आगे-पीछे हो तो codes expire दिखने लगते हैं।
6. Posters print कर लें।

## Venue पर setup (10 मिनट)

| मिनट | क्या करना है |
|---|---|
| 0 से 2 | Device को charging पर लगाएँ, internet से जोड़ें, door screen खोलें, और देख लें कि code हर 15 seconds में बदल रहा है। |
| 2 से 4 | Screen को entrance पर, सीने की ऊँचाई पर, अंदर आते लोगों की तरफ मुँह करके रखें, और खिड़की की तेज़ रोशनी से दूर। बड़ा hall हो तो door screen projector पर भी चला दें। |
| 4 से 6 | Posters चिपकाएँ, एक entrance पर और एक screen के बगल में। |
| 6 से 8 | किसी ऐसे साथी से उसके अपने phone पर test करवाएँ जो सच में event में है: scan, tap, stamp। Live count 1 हो जाना चाहिए। |
| 8 से 10 | दरवाज़े वाले साथी को नीचे वाली script और troubleshooting वाली table एक बार समझा दें। |

हर check-in असली होता है और mainnet पर दर्ज होता है, इसलिए test भी सिर्फ उसी से करवाएँ जो सच में वहाँ मौजूद है।

## क्या print करना है

1. **Entrance वाला poster** (A3 या A4): "यहाँ check-in करें। अपने phone का camera screen पर रखें और एक बार tap करें। न app चाहिए, न wallet।" साथ में event का नाम।
2. **Screen के बगल वाला poster** (A4): तीन steps, "Camera खोलें", "Code पर रखें", "Check in पर tap करें", और नीचे एक line: "कहीं अटक गए? दरवाज़े पर [[FILL: नाम]] से पूछ लें।"
3. **Mode 2 के लिए staff card**, सिर्फ तब जब mode 2 चला रहे हों: "अपना passport खोलिए, अपना code दिखाइए, हम scan कर लेंगे।"
4. **Reward card**, सिर्फ तब जब कोई sponsor पैसे दे रहा हो: "यहाँ आने के लिए आपको [[FILL: amount और token]] मिले हैं। इन्हें निकालने के लिए कभी भी QIE Wallet जोड़ लीजिए।"

Door वाला QR print मत कीजिए। वो हर 15 seconds में बदलता है और chain पुराने codes को कुछ ही मिनटों में reject कर देती है, तो print किया हुआ code लगभग तुरंत बेकार हो जाता है।

Print करने वाली files: `[[FILL: organizer kit बनने के बाद poster PDFs का link]]`

## Room में बोलने के लिए (लगभग 45 seconds)

शुरुआत में यह बोलें, अपने अंदाज़ में:

> सबको नमस्ते, शुरू करने से पहले बस एक छोटी सी बात। आज हम Showmark से check-in कर रहे हैं। दरवाज़े के पास वाली screen पर एक code है। अपने phone का camera उस पर रखिए, जो link खुले उस पर tap कीजिए, और फिर check in दबा दीजिए। कोई app नहीं चाहिए, कोई wallet नहीं चाहिए, और आपका एक रुपया भी नहीं लगेगा। कुछ ही seconds में आपके passport में एक stamp लग जाएगा, जो इस बात का सबूत है कि आप आज यहाँ थे।
>
> (अगर sponsor है।) आज [[FILL: sponsor का नाम]] यहाँ check-in करने वाले हर इंसान के लिए [[FILL: amount]] दे रहे हैं, और उसमें से आपका हिस्सा आपके passport में जुड़ जाएगा। उसे आप बाद में कभी भी QIE Wallet जोड़कर निकाल सकते हैं।
>
> Code हर पंद्रह seconds में बदलता है, तो उसकी photo भेजकर बाहर बैठे दोस्त check-in नहीं कर पाएँगे। कोई दिक्कत आए तो दरवाज़े पर [[FILL: नाम]] को बता दीजिए।

## Event के दौरान

- Live count को hall में दिख रही भीड़ से मिलाते रहें।
- Door screen को event खत्म होने के एक घंटे बाद तक चलने दें, ताकि देर से आने वाले भी check-in कर सकें।
- Door screen को कभी livestream, video call या WhatsApp group पर न दिखाएँ। Live stream ही इकलौता रास्ता है जिससे hall के बाहर बैठा कोई check-in कर सकता है।
- किसी की जगह check-in न करें, और जो लोग वहाँ नहीं हैं उनके phones से check-in न करवाएँ।

## Event के बाद

1. Door screen बंद करें, console में attendee list खोलें और CSV export कर लें।
2. अगर sponsor पैसे दे रहा है, तो हर check-in के तुरंत बाद payout जुड़ जाता है, और console में हर payout के साथ explorer का link होता है। Attendees को याद दिला दें कि वो अपना हिस्सा कभी भी निकाल सकते हैं।
3. अगर mode 2 बिना internet के चलाया था, तो event खत्म होने के 3 दिन के अंदर door device को internet से ज़रूर जोड़ें। Internet मिलते ही queue वाले check-ins chain पर चले जाते हैं, और 3 दिन के बाद वो दर्ज नहीं हो सकते।
4. Team को कुछ photos (सिर्फ उन लोगों की जिन्होंने हाँ कहा) और दो-चार lines भेज दें कि event कैसा रहा।

## कुछ गड़बड़ हो तो

| दिक्कत | क्या करें |
|---|---|
| Camera code नहीं पकड़ रहा | Phone को हाथ भर की दूरी पर रखें, camera का lens पोंछ लें, door screen की brightness बढ़ाएँ और उसे थोड़ा तिरछा करके glare हटाएँ। Google Lens या phone का अपना QR scanner आज़माएँ, या browser में `[[FILL: app URL]]/scan` खोलें। |
| Link Instagram या WhatsApp के अंदर ही खुल गया | Link को Chrome या Safari में खोलें। Pass उसी browser में save होता है, इसलिए लोग हर बार वही browser इस्तेमाल करें। |
| "Code expire हो गया" लिखा आ रहा है | दोबारा scan करें, नया code screen पर पहले से है। अगर सबके साथ यही हो रहा है, तो door device का time गलत है या internet बहुत slow है। Time को automatic पर करें और door screen reload करें। |
| "Check-in अभी शुरू नहीं हुआ" | Check-in शुरू होने के time से एक घंटा पहले खुलता है। अगर time गलत डल गया था तो उसे बदला नहीं जा सकता, इसलिए नया event बनाएँ और उसकी door screen खोलें। |
| "Event full है" | Capacity पूरी हो गई है। Console में जाकर capacity बढ़ा दें। |
| "पहले ही check-in हो चुका है" | कुछ नहीं करना, उनका stamp पहले से passport में है। |
| Door screen कह रही है कि door key authorized नहीं है या expire हो गई | Console खोलें और इसी device के लिए door key फिर से authorize करें, बस एक wallet signature लगेगा। |
| Device sleep में चला गया या browser बंद हो गया | उसी browser में door वाला link फिर से खोलें, key वहीं मिलेगी। अगर browser का data clear हो गया था, तो नई door key authorize करें। |
| Venue पर internet नहीं है | Door device को किसी phone के hotspot से जोड़ें। अगर किसी के phone में signal ही नहीं है, तो mode 2 चलाएँ: door device हर scan को queue में रख लेता है और internet आते ही भेज देता है। `[[FILL: पक्का करें कि जिसने पहले कभी Showmark खोला है, उसका code offline भी दिख जाता है]]` |
| दरवाज़े पर लंबी line लग गई | किसी दूसरे device पर एक और door screen खोल दें, दूसरे entrance पर या projector पर। हर device की अपनी door key होती है, उसे भी इसी तरह authorize करना होगा। |
| किसी के पास smartphone नहीं है या battery खत्म है | वो खुद check-in नहीं कर पाएँगे। किसी और के phone से उनका check-in मत कीजिए, क्योंकि वो किसी दूसरे इंसान का pass बन जाएगा। अपनी गिनती के लिए उनका नाम कागज़ पर लिख लें। |
| Payout नहीं दिख रहा | हाज़िरी तो दर्ज हो चुकी है, बस पैसा रुका हो सकता है: campaign को QIE ID चाहिए और attendee ने अभी ऐसा wallet नहीं जोड़ा, sponsor ने आपका event approve नहीं किया, budget खत्म हो गया, या dollar में तय campaign नए price का इंतज़ार कर रहा है। Console में वजह लिखी होती है। `[[FILL: पक्का करें कि रुके हुए payouts अपने-आप दोबारा होते हैं या button दबाना पड़ता है]]` |
| कोई पूछे, "मेरा data कहाँ जाता है?" | Pass उनके phone में रखी एक key है। उसमें पैसा नहीं रहता और कोई personal जानकारी नहीं माँगी जाती। Check-in QIE Mainnet पर public दर्ज होता है, पर एक address के साथ, नाम के साथ नहीं। |

## ये नियम कभी नहीं टूटते

- सिर्फ असली लोग और असली events। अपने ही passes से check-in करना, script से check-in करवाना, या ऐसा event दिखाना जो हुआ ही नहीं, सब मना है।
- Door screen कभी hall के बाहर share नहीं होगी।
- किसी से seed phrase या private key कभी मत माँगिए। Showmark को इसकी कभी ज़रूरत नहीं पड़ती।

ये नियम आपको, आपके sponsor को और हर attendee को बचाते हैं, और judges और sponsors chain पढ़कर सब देख सकते हैं।
