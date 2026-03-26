/**
 * Curated blocklist of disposable / throwaway email domains.
 * Covers the most abused providers. Expand as needed.
 */
export const DISPOSABLE_DOMAINS = new Set([
  // Mailinator family
  "mailinator.com","mailinator2.com","mailinator.net","mailinater.com",
  // Guerrilla Mail family
  "guerrillamail.com","guerrillamail.net","guerrillamail.org","guerrillamail.biz","guerrillamail.de",
  "guerrillamail.info","guerrillamailblock.com","grr.la","spam4.me","sharklasers.com",
  "guerrillamailblock.com","yopmail.fr","yopmail.com",
  // 10 Minute Mail
  "10minutemail.com","10minutemail.net","10minutemail.org","10minutemail.co.uk",
  "10minemail.com","tempmail.net","tempmail.com","tempmail.org",
  // Temp Mail / Throwam
  "throwam.com","throwam.net","throwaway.email",
  // Dispostable
  "dispostable.com","discard.email","discardmail.com","discardmail.de",
  // Trashmail family
  "trashmail.at","trashmail.com","trashmail.io","trashmail.me","trashmail.net",
  "trashmail.org","trashmail.xyz","trashmailer.com","trash-mail.at","trash-mail.com",
  "trash-mail.io",
  // Fakeinbox
  "fakeinbox.com","fake-box.com","fakemail.fr","fakemail.net",
  // Maildrop
  "maildrop.cc","mailnull.com","mailslurp.com","mailscrap.com",
  // Spamgourmet
  "spamgourmet.com","spamgourmet.net","spamgourmet.org",
  // Crap mail
  "crapmail.org","crap.dk",
  // Spambox / Spam
  "spambox.info","spambox.us","spambox.xyz","spambox.me","spamfree24.org",
  "spamgourmet.com","spamhere.com","spaml.com","spamspot.com","spamthis.co.uk",
  "spamtrap.ro",
  // Temp / Throwaway misc
  "temp-mail.org","temp-mail.ru","tempinbox.com","tempr.email","tempsky.com",
  "tempomail.fr","temporaryemail.net","temporaryemail.us","temporaryforwarding.com",
  "temporaryinbox.com","throwam.com","throwam.net","throwaway.email",
  "throwam.com","throwam.net",
  // Mailnesia / Mailnull
  "mailnesia.com","mailnull.com",
  // Getnada / Nada
  "getnada.com","nada.email","nada.ltd",
  // Inboxbear
  "inboxbear.com",
  // Mohmal
  "mohmal.com",
  // Mytemp
  "mytemp.email",
  // Owlpic
  "owlpic.com",
  // Sharklasers / guerrilla
  "sharklasers.com",
  // Mailsac
  "mailsac.com",
  // Burnermail
  "burnermail.io",
  // Tempinbox
  "tempinbox.com",
  // Eyepaste
  "eyepaste.com",
  // Filzmail
  "filzmail.com",
  // Spam.la
  "spam.la",
  // Spaml
  "spaml.com","spaml.de",
  // Despam
  "despam.it",
  // Einrot
  "einrot.com",
  // Fleckens
  "fleckens.hu",
  // Humaility
  "humaility.com",
  // Incognitomail
  "incognitomail.com","incognitomail.net","incognitomail.org",
  // Koszmail
  "koszmail.pl",
  // Kurzepost
  "kurzepost.de",
  // Lopl
  "lopl.co.cc",
  // Mailblocks
  "mailblocks.com",
  // Mailbucket
  "mailbucket.org",
  // Mailcat
  "mailcat.biz",
  // Mailchop
  "mailchop.com",
  // Mailimate
  "mailimate.com",
  // Mailme
  "mailme.lv","mailme24.com",
  // Mailmoat
  "mailmoat.com",
  // Mailms
  "mailms.com",
  // Mailnew
  "mailnew.com",
  // Mailrock
  "mailrock.biz",
  // Mailscrap
  "mailscrap.com",
  // Mailsiphon
  "mailsiphon.com",
  // Mailtemp
  "mailtemp.info",
  // Mailtome
  "mailtome.de",
  // Mailtothis
  "mailtothis.com",
  // Mailzilla
  "mailzilla.com","mailzilla.org",
  // Megamail
  "mega.zik.dj",
  // Meltmail
  "meltmail.com",
  // Mierdamail
  "mierdamail.com",
  // Mintemail
  "mintemail.com",
  // Nospamfor
  "nospamfor.us","nospammail.net","nospam.ze.tc",
  // Nowmymail
  "nowmymail.com",
  // Objectmail
  "objectmail.com",
  // Obobbo
  "obobbo.com",
  // Odaymail
  "odaymail.com",
  // Oneoffmail
  "oneoffmail.com",
  // Onewaymail
  "onewaymail.com",
  // Onlinemail
  "onlinemail.de",
  // Onmailserver
  "onmailserver.com",
  // Pedrothlopes
  "pedrothlopes.com",
  // Pookmail
  "pookmail.com",
  // Postonline
  "postonline.me",
  // Proxymail
  "proxymail.eu",
  // Rcpt
  "rcpt.at",
  // Reallymymail
  "reallymymail.com",
  // Rklips
  "rklips.com",
  // Rmqkr
  "rmqkr.net",
  // Rotaniliam
  "rotaniliam.com",
  // Rtrtr
  "rtrtr.com",
  // S0ny
  "s0ny.net",
  // Safe-mail
  "safe-mail.net",
  // Safetypost
  "safetypost.de",
  // Sendspamhere
  "sendspamhere.com",
  // Sharklasers
  "sharklasers.com",
  // Shieldedmail
  "shieldedmail.com",
  // Shitmail
  "shitmail.org","shitmail.me",
  // Shortmail
  "shortmail.net",
  // Sibmail
  "sibmail.com",
  // Smellfear
  "smellfear.com",
  // Snkmail
  "snkmail.com",
  // Sofimail
  "sofimail.com",
  // Sofort-mail
  "sofort-mail.de",
  // Sogetthis
  "sogetthis.com",
  // Soisz
  "soisz.com",
  // Spam
  "spam.su","spam.org.tr","spam.la","spam.care","spambog.com","spambog.de",
  "spambog.ru","spamcero.com","spamcon.org","spamcorptastic.com","spamcowboy.com",
  "spamcowboy.net","spamcowboy.org","spamday.com","spamex.com","spamfree.eu",
  "spamfree24.de","spamfree24.eu","spamfree24.info","spamfree24.net","spamfree24.org",
  "spamgoes.in","spamgourmet.com","spamgourmet.net","spamgourmet.org","spamherelots.com",
  "spamhereplease.com","spamhole.com","spamify.com","spaminmotion.com","spamkill.info",
  "spaml.com","spaml.de","spammotel.com","spamoff.de","spamslicer.com",
  "spamspot.com","spamthis.co.uk","spamthisplease.com","spamtrail.com","speed.1s.fr",
  // Superrito
  "superrito.com",
  // Supergreatmail
  "supergreatmail.com",
  // Svk
  "svk.jp",
  // Swift-mail
  "swift-mail.com",
  // Szzc
  "szzc.com",
  // T-online
  // (legitimate German provider — do NOT block)
  // Tafmail
  "tafmail.com",
  // Tagyourself
  "tagyourself.com",
  // Teewars
  "teewars.org",
  // Teleworm
  "teleworm.com","teleworm.us",
  // Theliminal
  "theliminal.com",
  // Thisisnotmyrealemail
  "thisisnotmyrealemail.com",
  // Throwam
  "throwam.com",
  // Tilien
  "tilien.com",
  // Tmailinator
  "tmailinator.com",
  // Toiea
  "toiea.com",
  // Topranklist
  "topranklist.de",
  // Tranceversal
  "tranceversal.com",
  // Trash2009
  "trash2009.com",
  // Trashdevil
  "trashdevil.com","trashdevil.de",
  // Trashmail
  "trashmail.at","trashmail.com","trashmail.io","trashmail.me","trashmail.net",
  "trashmail.org","trashmail.xyz",
  // Trbvm
  "trbvm.com",
  // Trillianpro
  "trillianpro.com",
  // Tryalert
  "tryalert.com",
  // Turual
  "turual.com",
  // Twinmail
  "twinmail.de",
  // Tyldd
  "tyldd.com",
  // Uggsrock
  "uggsrock.com",
  // Umail
  "umail.net",
  // Uroid
  "uroid.com",
  // Us
  "us.af",
  // Venompen
  "venompen.com",
  // Veryrealemail
  "veryrealemail.com",
  // Vidchart
  "vidchart.com",
  // Viditag
  "viditag.com",
  // Viewcastmedia
  "viewcastmedia.com","viewcastmedia.net","viewcastmedia.org",
  // Vomoto
  "vomoto.com",
  // Vubby
  "vubby.com",
  // Wasteland
  "wasteland.raven.ws",
  // Webemail
  "webemail.me",
  // Webm4il
  "webm4il.info",
  // Weg-werf-email
  "weg-werf-email.de",
  // Wegwerf-email
  "wegwerf-email.at","wegwerf-email.de","wegwerf-email.net","wegwerf-email.org",
  // Wegwerfadresse
  "wegwerfadresse.de",
  // Wegwerfemail
  "wegwerfemail.com","wegwerfemail.de","wegwerfemail.net","wegwerfemail.org",
  // Wegwerfmail
  "wegwerfmail.de","wegwerfmail.net","wegwerfmail.org",
  // Wegwerfnummer
  "wegwerfnummer.de",
  // Wh4f
  "wh4f.org",
  // Whyspam
  "whyspam.me",
  // Willselfdestruct
  "willselfdestruct.com",
  // Winemaven
  "winemaven.info",
  // Wronghead
  "wronghead.com",
  // Wuzupmail
  "wuzupmail.net",
  // Xagloo
  "xagloo.com","xagloo.co",
  // Xemaps
  "xemaps.com",
  // Xents
  "xents.com",
  // Xmaily
  "xmaily.com",
  // Xoxy
  "xoxy.net",
  // Xyzfree
  "xyzfree.net",
  // Yapped
  "yapped.net",
  // Yeah
  "yeah.net",
  // Yep
  "yep.it",
  // Yogamaven
  "yogamaven.com",
  // Yopmail
  "yopmail.com","yopmail.fr","yopmail.gq","cool.fr.nf","jetable.fr.nf","nospam.ze.tc",
  "nomail.xl.cx","mega.zik.dj","speed.1s.fr","courriel.fr.nf","moncourrier.fr.nf",
  "monemail.fr.nf","monmail.fr.nf",
  // You
  "you.e4ward.com",
  // Youam
  "youam.de",
  // Yourdomain
  "yourspam.eu","ypmail.webarnak.fr.eu.org",
  // Yuurok
  "yuurok.com",
  // Z1p
  "z1p.biz",
  // Zain
  "zain.com",
  // Zebins
  "zebins.com","zebins.eu",
  // Zehnminuten
  "zehnminuten.de",
  // Zetmail
  "zetmail.com",
  // Zhouemail
  "zhouemail.510520.org",
  // Zippymail
  "zippymail.info",
  // Zoaxe
  "zoaxe.com",
  // Zoemail
  "zoemail.net","zoemail.org",
  // Zomg
  "zomg.info",
  // Inboxclean
  "inboxclean.com","inboxclean.org",
  // Hmamail
  "hmamail.com",
  // Yomail
  "yomail.info",
  // Nwytg
  "nwytg.net","nwytg.com",
  // Tempinbox
  "tempinbox.co.uk","tempinbox.com",
  // Mailapps
  "mailapps.eu",
  // Mailexpire
  "mailexpire.com",
  // Mailfree
  "mailfreeonline.com",
  // Mailguard
  "mailguard.me",
  // Mailhazard
  "mailhazard.com","mailhazard.us",
  // Mailimate
  "mailimate.com",
  // Mailkept
  "mailkept.com",
  // Mailmate
  "mailmate.com",
  // Mailme
  "mailme.lv","mailme24.com","mailmetrash.com",
  // Mailmetrash
  "mailmetrash.com",
  // Mailmoat
  "mailmoat.com",
  // Mailnesia
  "mailnesia.com",
  // Mailzero
  "mailzero.com",
  // Mailbomb
  "mailbomb.net",
  // Jetable
  "jetable.com","jetable.fr.nf","jetable.net","jetable.org",
  // Kukumail
  "kukumail.com",
  // Lol
  "lol.com","lol.ovpn.to",
  // Lortemail
  "lortemail.dk",
  // Losemymail
  "losemymail.com",
  // Lovemeleaveme
  "lovemeleaveme.com",
  // Lr78
  "lr78.com",
  // Lroid
  "lroid.com",
  // Lukop
  "lukop.dk",
  // Mailexpire
  "mailexpire.com",
  // Maildrop
  "maildrop.cc",
  // Abyssmail
  "abyssmail.com",
  // Amilegit
  "amilegit.com",
  // Anonbox
  "anonbox.net",
  // Anonymbox
  "anonymbox.com",
  // Antispam
  "antispam.de","antispam24.de","antispam.ro","antispammail.de",
  // Armyspy
  "armyspy.com",
  // Assed
  "assed.com",
  // Baxomale
  "baxomale.ht.cx",
  // Beefmilk
  "beefmilk.com",
  // Bigstring
  "bigstring.com",
  // Binkmail
  "binkmail.com",
  // Bio-muesli
  "bio-muesli.net",
  // Bofthew
  "bofthew.com",
  // Boun
  "boun.cr",
  // Boxformail
  "boxformail.in",
  // Brefmail
  "brefmail.com",
  // Broadbandninja
  "broadbandninja.com",
  // Bugmenot
  "bugmenot.com",
  // Bumpymail
  "bumpymail.com",
  // Casualdx
  "casualdx.com",
  // Chogmail
  "chogmail.com",
  // Choicemail1
  "choicemail1.com",
  // Clixser
  "clixser.com",
  // Cloverdaleauto
  "cloverdaleauto.com",
  // Coieo
  "coieo.com",
  // Consumerriot
  "consumerriot.com",
  // Cool
  "cool.fr.nf",
  // Courriel
  "courriel.fr.nf",
  // Coverme
  "coverme.com",
  // Crapmail
  "crapmail.org",
  // Curryworld
  "curryworld.de",
  // Cust
  "cust.in",
  // Dacoolest
  "dacoolest.com",
  // Dandikmail
  "dandikmail.com",
  // Deadaddress
  "deadaddress.com",
  // Deadspam
  "deadspam.com",
  // Despam
  "despam.it",
  // Devnullmail
  "devnullmail.com",
  // Dingbone
  "dingbone.com",
  // Discard
  "discard.email","discardmail.com","discardmail.de",
  // Dodgeit
  "dodgeit.com",
  // Dodgmail
  "dodgmail.de",
  // Dontreg
  "dontreg.com",
  // Dontsendmespam
  "dontsendmespam.de",
  // Drdrb
  "drdrb.com","drdrb.net",
  // Dumpmail
  "dumpmail.de",
  // Dumpyemail
  "dumpyemail.com",
  // E4ward
  "e4ward.com",
  // Einrot
  "einrot.com",
  // Emkei
  "emkei.cz",
  // Enterto
  "enterto.com",
  // Ephemail
  "ephemail.net",
  // Etranquil
  "etranquil.com","etranquil.net","etranquil.org",
  // Evopo
  "evopo.com",
  // Explodemail
  "explodemail.com",
  // Express
  "express.net.ua",
  // Extremail
  "extremail.ru",
]);

/**
 * Returns true if the email's domain is a known disposable/throwaway provider.
 */
export function isDisposableEmail(email: string): boolean {
  const parts = email.toLowerCase().trim().split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1];
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Also catch common subdomain tricks e.g. user@mail.mailinator.com
  const domainParts = domain.split(".");
  if (domainParts.length > 2) {
    const rootDomain = domainParts.slice(-2).join(".");
    if (DISPOSABLE_DOMAINS.has(rootDomain)) return true;
  }
  return false;
}
