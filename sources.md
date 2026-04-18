HiFi Speakers & IEMs
Enthusiast classifieds (high signal, scrape-friendly):

US Audio Mart (usaudiomart.com) — you've already got this one. Largest US-focused hifi classifieds. Has a dedicated IEM/headphone section too.
Canuck Audio Mart (canuckaudiomart.com) — same platform, Canadian listings. Worth including since shipping cross-border on audio gear is common and cheap.
Head-Fi Classifieds (head-fi.org/classifieds) — this is the IEM marketplace. Active listings for 64Audio, ZMF, Empire Ears, etc. Head-Fi Scraping will require handling their forum-style layout but selectors should be stable. This is where your Elysian Apostle or FATfreq Grand Maestro would show up.
Audiogon (audiogon.com) — skews higher-end and older-demographic. Focused on high-end audio Audiogon — great for speakers, less so for IEMs.
HiFi Shark (hifishark.com) — you've got this. It's an aggregator that pulls from Head-Fi, US Audio Mart, Canuck Audio Mart, and dozens of international sites HifiShark including Kleinanzeigen, Marktplaats, Yahoo Auctions JP, etc. This is your safety net — anything listed on the niche sites will likely show up here too.

Retail/consignment (curated, possibly scrapeable):

The Music Room (tmraudio.com) — consignment dealer that authenticates and tests everything TMR Audio. Prices are higher but condition is guaranteed. They list new inventory regularly.
Bloom Audio Preowned (bloomaudio.com/collections/preowned) — trade-in IEMs that are tested and cleaned Bloom Audio. Smaller inventory but relevant for your IEM interests specifically.
Reverb (reverb.com) — mostly pro audio/instruments but has a home audio section including subwoofers. Worth a scrape for SVS specifically.

General marketplaces (high volume, noisier):

Facebook Marketplace — you've got this
eBay (ebay.com) — obvious, but worth including for price-dropped auctions on specific models. eBay has structured data and is relatively scrape-friendly.
Craigslist — you mentioned this is already working

Cars (W211 E500 / M113 Platform)
Aggregators (one scrape covers many sources):

AutoTempest (autotempest.com) — aggregates millions of listings from dealers and private sellers AutoTempest across Cars.com, eBay Motors, Carvana, Hemmings, Cars & Bids, and more. This is the "HiFi Shark of cars." One scrape here covers a lot of ground. Their search supports make/model/year filtering.

Auction sites (where the interesting stuff lands):

Cars & Bids (carsandbids.com) — Doug DeMuro's site. Has an E500 search page Cars & Bids. W211s show up periodically and tend to be better-documented than average.
Bring a Trailer (bringatrailer.com) — higher-end, but E55 AMGs appear regularly and occasionally well-sorted E500s. Good for price reference even if you don't buy here.

Enthusiast forums with classifieds:

MBWorld.org Forums Marketplace (mbworld.org/forums/market) — Mercedes-Benz specific classifieds MBWorld. The W211 subforum is active. Sellers here tend to be enthusiasts who know (and document) what they have — SBC status, service records, etc.
BenzWorld.org (benzworld.org) — another large Mercedes owner community with classifieds Mercedes-Benz Forum. Similar deal — enthusiast sellers.
PeachParts / Mercedes-Benz Forum (benzworld.org and peachparts.com) — older-school MB forums, occasionally have W211s.

Standard used car sites (high volume):

Facebook Marketplace — already covered
Craigslist — already working
Cars.com — structured listings, good filtering by year/make/model
CarGurus (cargurus.com) — good price analysis built in, shows "deal" ratings
eBay Motors (ebay.com/motors) — auction format means deals happen. Filter by year range + "E500" + distance from Boston
CLASSIC.COM (classic.com) — tracks W211 market data including sale prices Classic.com. Useful both as a scrape target and as a price reference source for your YAML.

Mechanical Keyboards
Dedicated keyboard marketplaces:

r/mechmarket (Reddit) — the largest keyboard marketplace on the web with 250,000+ members HHKB. This is where the volume is. Scraping Reddit is relatively straightforward via their JSON API (reddit.com/r/mechmarket.json), no Puppeteer needed. The structured post format (title has [US-MA] [H] ... [W] ...) makes LLM parsing easy.
Keebswap (keebswap.com) — community marketplace for mechanical keyboards, keycaps, artisans, switches, and more Keebswap. Successor to Agora Mech. Free for buyers and sellers.
KFA Marketplace (kfamarketplace.com) — dedicated mechanical keyboard marketplace for keyboards, keycaps, switches, and artisans Kfamarketplace.
GeekHack Classifieds (geekhack.org) — forum-based platform where the mechanical keyboard community connects Meetion. Older-school but still active, especially for group buy extras and artisans.

General marketplaces:

eBay — large volume of keyboards, especially mass-produced customs (Keychron, GMMK, etc.)
Facebook Marketplace — already covered
Craigslist — already working, though keyboard volume is lower here


A note on priority: For each category, I'd tier the sources by how much unique signal they add vs. what you're already covering through aggregators:
For audio, HiFi Shark already aggregates USAM + Canuck + Head-Fi + dozens more — so the main value-add of scraping the individual sites is speed (catching something before it shows up on HiFi Shark's next crawl). Head-Fi classifieds for IEMs specifically is worth a dedicated scraper since HiFi Shark's IEM coverage seems noisier.
For cars, AutoTempest is your HiFi Shark equivalent — it covers the major sites. The forum classifieds (MBWorld, BenzWorld) are genuinely additive since aggregators don't index them.
For keyboards, r/mechmarket is the 80/20 — it's where the overwhelming majority of transactions happen. The dedicated marketplaces (Keebswap, KFA) are supplementary.